"""Expenses (spec D.7.4, plan §0.6/§3): quick-record, above-threshold
manager approval, receipt-photo upload, and recurring-expense scheduling.

**A `draft`/`pending_approval` expense is a mutable staging row, never an
event** (plan §0.6) -- `Expense` is a plain entity table
(models/expenses.py), CRUD'd directly the way `Sale`/`Customer` are.
Only on approval (or immediate auto-approval below the threshold) does
this router append `EXPENSE_RECORDED` -- the SAME event type and the SAME
already-wired `money_location_balance` handler Phase 0 built -- and stamp
`status = "posted"`. A `rejected` expense never becomes an event at all;
it simply stops mattering to the ledger, exactly as if it had never been
proposed.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from sqlalchemy import select

from operatoros_api.api.deps import RequestContext, idempotency_key_header, require_capability
from operatoros_api.idempotency_service import (
    claim_or_replay,
    complete,
    fingerprint_request,
    get_existing,
)
from operatoros_api.ledger import EnvelopeValidationError, EventEnvelopeInput, append_event
from operatoros_api.models.expenses import Expense, RecurringExpense
from operatoros_api.schemas.expenses import (
    ExpenseCreateRequest,
    ExpenseOut,
    ExpenseRejectRequest,
    ReceiptUploadOut,
    RecurringExpenseCreateRequest,
    RecurringExpenseOut,
    RecurringExpenseUpdateRequest,
)
from operatoros_api.storage import get_file_storage

router = APIRouter(prefix="/api/v1/expenses", tags=["expenses"])

# D.7.4: "above a threshold, a manager must approve before it posts." Same
# hardcoded-pending-a-real-Settings-screen pattern as
# api/routers/sales.py::DISCOUNT_APPROVAL_THRESHOLD_PERCENT and
# api/routers/debt.py::WRITE_OFF_NAME_CONFIRM_THRESHOLD_MINOR.
EXPENSE_APPROVAL_THRESHOLD_MINOR = 5_000_00

_RECURRING_INTERVAL_DAYS = {"daily": 1, "weekly": 7, "monthly": 30}


def _expense_out(expense: Expense) -> ExpenseOut:
    return ExpenseOut(
        id=expense.id,
        location_id=expense.location_id,
        amount_minor=expense.amount_minor,
        category=expense.category,
        money_location=expense.money_location,
        payee=expense.payee,
        expense_date=expense.expense_date.isoformat(),
        note=expense.note,
        receipt_photo_url=expense.receipt_photo_url,
        ocr_status=expense.ocr_status,
        status=expense.status,
        created_by_user_id=expense.created_by_user_id,
        approved_by_user_id=expense.approved_by_user_id,
        approved_at=expense.approved_at.isoformat() if expense.approved_at else None,
        rejected_reason=expense.rejected_reason,
    )


async def _post_expense(ctx: RequestContext, expense: Expense) -> None:
    """Appends EXPENSE_RECORDED and marks the row posted -- the one place
    an Expense actually becomes a ledger fact. Called both by `create_expense`
    (below-threshold, auto-approved) and `approve_expense` (above-threshold,
    manager-approved) so there is exactly one code path that ever does this."""
    try:
        event = await append_event(
            ctx.session,
            EventEnvelopeInput(
                business_id=ctx.business_id,
                type="EXPENSE_RECORDED",
                payload={
                    "amount_minor": expense.amount_minor,
                    "category": expense.category,
                    "money_location": expense.money_location,
                    "payee": expense.payee,
                    "note": expense.note,
                },
                actor_user_id=ctx.user_id,
                actor_source="api",
                location_id=expense.location_id,
                occurred_at=datetime.combine(expense.expense_date, datetime.min.time()).replace(
                    tzinfo=UTC
                ),
            ),
        )
    except EnvelopeValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    expense.status = "posted"
    expense.event_id = event.id


@router.post("", response_model=ExpenseOut, status_code=201)
async def create_expense(
    body: ExpenseCreateRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("expense.record")),
) -> ExpenseOut:
    raw_body = await request.body()
    fingerprint = fingerprint_request("POST", "/api/v1/expenses", ctx.business_id, raw_body)
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint="POST /api/v1/expenses",
        fingerprint=fingerprint,
    )
    if claimed_id is None:
        existing = await get_existing(ctx.session, business_id=ctx.business_id, key=idempotency_key)
        if existing.request_fingerprint != fingerprint:
            raise HTTPException(
                status_code=409,
                detail="This Idempotency-Key was already used for a different request.",
            )
        if existing.response_body is None:
            raise RuntimeError("idempotency row has no response_body despite being complete")
        return ExpenseOut(**existing.response_body)

    if body.amount_minor <= 0:
        raise HTTPException(status_code=422, detail="amount_minor must be positive.")
    try:
        expense_date = date.fromisoformat(body.expense_date)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid expense_date.") from exc

    expense = Expense(
        business_id=ctx.business_id,
        location_id=body.location_id,
        amount_minor=body.amount_minor,
        category=body.category,
        money_location=body.money_location,
        payee=body.payee,
        expense_date=expense_date,
        note=body.note,
        receipt_photo_url=body.receipt_photo_url,
        status="pending_approval",
        created_by_user_id=ctx.user_id,
    )
    ctx.session.add(expense)
    await ctx.session.flush()

    if body.amount_minor < EXPENSE_APPROVAL_THRESHOLD_MINOR:
        expense.status = "posted"
        expense.approved_at = datetime.now(UTC)
        await _post_expense(ctx, expense)
        await ctx.session.flush()

    out = _expense_out(expense)
    await complete(ctx.session, claimed_id=claimed_id, status_code=201, body=out.model_dump())
    return out


@router.get("", response_model=list[ExpenseOut])
async def list_expenses(
    status: str | None = None,
    ctx: RequestContext = Depends(require_capability("report.view")),
) -> list[ExpenseOut]:
    stmt = select(Expense).where(Expense.business_id == ctx.business_id)
    if status:
        stmt = stmt.where(Expense.status == status)
    result = await ctx.session.execute(stmt.order_by(Expense.created_at.desc()))
    return [_expense_out(e) for e in result.scalars()]


@router.get("/{expense_id}", response_model=ExpenseOut)
async def get_expense(
    expense_id: str, ctx: RequestContext = Depends(require_capability("report.view"))
) -> ExpenseOut:
    expense = await ctx.session.get(Expense, expense_id)
    if expense is None:
        raise HTTPException(status_code=404, detail="Not found.")
    return _expense_out(expense)


@router.post("/{expense_id}/approve", response_model=ExpenseOut)
async def approve_expense(
    expense_id: str,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("expense.approve")),
) -> ExpenseOut:
    raw_body = await request.body()
    fingerprint = fingerprint_request(
        "POST", f"/api/v1/expenses/{expense_id}/approve", ctx.business_id, raw_body
    )
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint=f"POST /api/v1/expenses/{expense_id}/approve",
        fingerprint=fingerprint,
    )
    if claimed_id is None:
        existing = await get_existing(ctx.session, business_id=ctx.business_id, key=idempotency_key)
        if existing.request_fingerprint != fingerprint:
            raise HTTPException(
                status_code=409,
                detail="This Idempotency-Key was already used for a different request.",
            )
        if existing.response_body is None:
            raise RuntimeError("idempotency row has no response_body despite being complete")
        return ExpenseOut(**existing.response_body)

    expense = await ctx.session.get(Expense, expense_id)
    if expense is None:
        raise HTTPException(status_code=404, detail="Not found.")
    if expense.status != "pending_approval":
        raise HTTPException(
            status_code=409, detail=f"This expense is {expense.status}, not pending_approval."
        )

    expense.approved_by_user_id = ctx.user_id
    expense.approved_at = datetime.now(UTC)
    await _post_expense(ctx, expense)
    await ctx.session.flush()

    out = _expense_out(expense)
    await complete(ctx.session, claimed_id=claimed_id, status_code=200, body=out.model_dump())
    return out


@router.post("/{expense_id}/reject", response_model=ExpenseOut)
async def reject_expense(
    expense_id: str,
    body: ExpenseRejectRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("expense.approve")),
) -> ExpenseOut:
    raw_body = await request.body()
    fingerprint = fingerprint_request(
        "POST", f"/api/v1/expenses/{expense_id}/reject", ctx.business_id, raw_body
    )
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint=f"POST /api/v1/expenses/{expense_id}/reject",
        fingerprint=fingerprint,
    )
    if claimed_id is None:
        existing = await get_existing(ctx.session, business_id=ctx.business_id, key=idempotency_key)
        if existing.request_fingerprint != fingerprint:
            raise HTTPException(
                status_code=409,
                detail="This Idempotency-Key was already used for a different request.",
            )
        if existing.response_body is None:
            raise RuntimeError("idempotency row has no response_body despite being complete")
        return ExpenseOut(**existing.response_body)

    expense = await ctx.session.get(Expense, expense_id)
    if expense is None:
        raise HTTPException(status_code=404, detail="Not found.")
    if expense.status != "pending_approval":
        raise HTTPException(
            status_code=409, detail=f"This expense is {expense.status}, not pending_approval."
        )
    if not body.reason:
        raise HTTPException(status_code=422, detail="A reason is required to reject an expense.")

    expense.status = "rejected"
    expense.rejected_reason = body.reason
    expense.approved_by_user_id = ctx.user_id
    expense.approved_at = datetime.now(UTC)
    await ctx.session.flush()

    out = _expense_out(expense)
    await complete(ctx.session, claimed_id=claimed_id, status_code=200, body=out.model_dump())
    return out


@router.post("/receipt-upload", response_model=ReceiptUploadOut, status_code=201)
async def upload_receipt(
    file: UploadFile, ctx: RequestContext = Depends(require_capability("expense.record"))
) -> ReceiptUploadOut:
    """D.7.4: "a receipt photo upload (stored, OCR'd for amount and date
    to pre-fill the form)." The upload and storage are real
    (`storage.py`); OCR pre-fill is a documented no-op seam -- no OCR
    provider credentials exist in this sandbox, so `ocr_prefill` is always
    `None` rather than fabricated. No `Idempotency-Key` here: a receipt
    upload has no money/stock side effect to double-apply (unlike
    `create_expense`, which does), so the usual mutating-endpoint
    convention doesn't apply -- a retried upload just stores the file
    again under a fresh random name, which is harmless."""
    content = await file.read()
    url = await get_file_storage().save(
        business_id=ctx.business_id, filename=file.filename or "receipt", content=content
    )
    return ReceiptUploadOut(receipt_photo_url=url, ocr_prefill=None)


# --- recurring expenses -------------------------------------------------


def _recurring_out(r: RecurringExpense) -> RecurringExpenseOut:
    return RecurringExpenseOut(
        id=r.id,
        location_id=r.location_id,
        amount_minor=r.amount_minor,
        category=r.category,
        money_location=r.money_location,
        payee=r.payee,
        note=r.note,
        interval=r.interval,
        next_run_date=r.next_run_date.isoformat(),
        active=r.active,
    )


@router.post("/recurring", response_model=RecurringExpenseOut, status_code=201)
async def create_recurring_expense(
    body: RecurringExpenseCreateRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("expense.approve")),
) -> RecurringExpenseOut:
    raw_body = await request.body()
    fingerprint = fingerprint_request(
        "POST", "/api/v1/expenses/recurring", ctx.business_id, raw_body
    )
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint="POST /api/v1/expenses/recurring",
        fingerprint=fingerprint,
    )
    if claimed_id is None:
        existing = await get_existing(ctx.session, business_id=ctx.business_id, key=idempotency_key)
        if existing.request_fingerprint != fingerprint:
            raise HTTPException(
                status_code=409,
                detail="This Idempotency-Key was already used for a different request.",
            )
        if existing.response_body is None:
            raise RuntimeError("idempotency row has no response_body despite being complete")
        return RecurringExpenseOut(**existing.response_body)

    if body.interval not in _RECURRING_INTERVAL_DAYS:
        raise HTTPException(status_code=422, detail=f"Unknown interval {body.interval!r}.")
    try:
        next_run_date = date.fromisoformat(body.next_run_date)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid next_run_date.") from exc

    recurring = RecurringExpense(
        business_id=ctx.business_id,
        location_id=body.location_id,
        amount_minor=body.amount_minor,
        category=body.category,
        money_location=body.money_location,
        payee=body.payee,
        note=body.note,
        interval=body.interval,
        next_run_date=next_run_date,
        active=True,
        created_by_user_id=ctx.user_id,
    )
    ctx.session.add(recurring)
    await ctx.session.flush()

    out = _recurring_out(recurring)
    await complete(ctx.session, claimed_id=claimed_id, status_code=201, body=out.model_dump())
    return out


@router.get("/recurring/list", response_model=list[RecurringExpenseOut])
async def list_recurring_expenses(
    ctx: RequestContext = Depends(require_capability("report.view")),
) -> list[RecurringExpenseOut]:
    result = await ctx.session.execute(
        select(RecurringExpense).where(RecurringExpense.business_id == ctx.business_id)
    )
    return [_recurring_out(r) for r in result.scalars()]


@router.patch("/recurring/{recurring_expense_id}", response_model=RecurringExpenseOut)
async def update_recurring_expense(
    recurring_expense_id: str,
    body: RecurringExpenseUpdateRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("expense.approve")),
) -> RecurringExpenseOut:
    raw_body = await request.body()
    fingerprint = fingerprint_request(
        "PATCH", f"/api/v1/expenses/recurring/{recurring_expense_id}", ctx.business_id, raw_body
    )
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint=f"PATCH /api/v1/expenses/recurring/{recurring_expense_id}",
        fingerprint=fingerprint,
    )
    if claimed_id is None:
        existing = await get_existing(ctx.session, business_id=ctx.business_id, key=idempotency_key)
        if existing.request_fingerprint != fingerprint:
            raise HTTPException(
                status_code=409,
                detail="This Idempotency-Key was already used for a different request.",
            )
        if existing.response_body is None:
            raise RuntimeError("idempotency row has no response_body despite being complete")
        return RecurringExpenseOut(**existing.response_body)

    recurring = await ctx.session.get(RecurringExpense, recurring_expense_id)
    if recurring is None:
        raise HTTPException(status_code=404, detail="Not found.")

    if body.amount_minor is not None:
        recurring.amount_minor = body.amount_minor
    if body.category is not None:
        recurring.category = body.category
    if body.money_location is not None:
        recurring.money_location = body.money_location
    if body.payee is not None:
        recurring.payee = body.payee
    if body.note is not None:
        recurring.note = body.note
    if body.interval is not None:
        if body.interval not in _RECURRING_INTERVAL_DAYS:
            raise HTTPException(status_code=422, detail=f"Unknown interval {body.interval!r}.")
        recurring.interval = body.interval
    if body.next_run_date is not None:
        try:
            recurring.next_run_date = date.fromisoformat(body.next_run_date)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Invalid next_run_date.") from exc
    if body.active is not None:
        recurring.active = body.active
    await ctx.session.flush()

    out = _recurring_out(recurring)
    await complete(ctx.session, claimed_id=claimed_id, status_code=200, body=out.model_dump())
    return out


def advance_next_run_date(current: date, interval: str) -> date:
    """Pure helper shared with `tasks/recurring_expenses.py` -- a fixed-days
    approximation (30 for "monthly"), not full calendar-month arithmetic.
    Documented simplification, same spirit as other hardcoded-pending-
    refinement values in this router."""
    return current + timedelta(days=_RECURRING_INTERVAL_DAYS[interval])
