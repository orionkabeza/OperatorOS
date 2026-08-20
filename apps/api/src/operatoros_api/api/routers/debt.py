"""The Debt Book (spec D.6, plan §0.2/§2/§3).

`take_payment` is this router's `create_sale`-equivalent safety-critical
path: one atomic transaction that resolves allocation (auto-oldest-first or
manual per invoice, D.6.4), appends `PAYMENT_RECEIVED`, and lets the
projection framework move money in `money_location_balance` and debt down
in `customer_balance` for that SAME event, in the SAME transaction --
either both happen or neither does (see
projections/customer_balance.py::on_payment_received_balance and
projections/money_location_balance.py::on_payment_received_money, and
tests/test_debt_payment_atomicity.py for the proof).

**A credit sale IS the invoice** (plan §0.2) -- "open invoices" here always
means "credit-method `sale_payments` lines on a `Sale` whose
`credit_total_minor - Σ payment_allocations.amount_minor` is still > 0."
`_open_invoices_for_business`/`_open_invoices_for_customer` are the two
query shapes every ageing/statement/queue computation in this router
builds on; kept as pure post-processing over two grouped SQL queries
(credit totals per sale, allocations per sale) rather than N+1 per-customer
queries, since the header band and accounts table both need this figure
for potentially every customer in the business at once.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select

from operatoros_api.api.deps import RequestContext, idempotency_key_header, require_capability
from operatoros_api.debt_ageing import (
    OpenInvoice,
    ageing_bucket,
    auto_allocate,
    days_overdue,
    open_invoices_for_business,
    open_invoices_for_customer,
)
from operatoros_api.idempotency_service import (
    claim_or_replay,
    complete,
    fingerprint_request,
    get_existing,
)
from operatoros_api.ledger import EnvelopeValidationError, EventEnvelopeInput, append_event
from operatoros_api.models.customers import Customer, CustomerBalance
from operatoros_api.models.events import Event
from operatoros_api.models.paylink import PayLink
from operatoros_api.models.payments import PaymentAllocation
from operatoros_api.models.reminders import ReminderLog
from operatoros_api.models.sales import Sale, SalePayment
from operatoros_api.notifications import get_notification_sender
from operatoros_api.projections.money_location_balance import payment_method_account_key
from operatoros_api.schemas.debt import (
    AgeingBucketOut,
    AllocationOut,
    ChaseQueueEntryOut,
    ContactHistoryEntryOut,
    CustomerAccountOut,
    DebtHeaderOut,
    InvoiceOut,
    LogCallRequest,
    StatementLineOut,
    TakePaymentOut,
    TakePaymentRequest,
    WriteOffOut,
    WriteOffRequest,
)
from operatoros_api.schemas.pay import PayLinkCreateOut, PayLinkCreateRequest
from operatoros_api.security.tokens import create_pay_link_token

router = APIRouter(prefix="/api/v1/debt", tags=["debt"])

VALID_PAYMENT_METHODS = frozenset({"cash", "momo", "airtel", "bank", "cheque"})
# D.6.6: "above a threshold, typing the customer name" -- like sales.py's
# DISCOUNT_APPROVAL_THRESHOLD_PERCENT, a hardcoded default pending a real
# Back Office thresholds setting (D.10.6), documented in docs/DECISIONS.md
# rather than silently invented as something more elaborate.
WRITE_OFF_NAME_CONFIRM_THRESHOLD_MINOR = 5_000_00
DUE_SOON_DAYS = 7

# Local aliases so the rest of this file (and its tests) can keep using the
# names it already had before `debt_ageing.py` was factored out.
_days_overdue = days_overdue
_ageing_bucket = ageing_bucket
_open_invoices_for_business = open_invoices_for_business
_open_invoices_for_customer = open_invoices_for_customer


async def _last_payment_by_customer(session, business_id: str) -> dict[str, datetime]:
    # `customer_id_expr` is built ONCE and reused in both SELECT and GROUP
    # BY -- two textually-identical-but-separately-constructed
    # `Event.payload["customer_id"].astext` expressions each get their own
    # bind parameter under the hood, and Postgres cannot verify two
    # different bind params are equal at parse time, so it rejects the
    # query with "column events.payload must appear in the GROUP BY
    # clause" even though the SQL text looks correct. Reusing the same
    # clause-element object makes SQLAlchemy compile it identically in both
    # places (same bind param), which is what Postgres needs to recognize
    # the GROUP BY as covering the SELECT list.
    customer_id_expr = Event.payload["customer_id"].astext
    result = await session.execute(
        select(customer_id_expr, func.max(Event.occurred_at))
        .where(Event.business_id == business_id, Event.type == "PAYMENT_RECEIVED")
        .group_by(customer_id_expr)
    )
    return {row[0]: row[1] for row in result.all() if row[0]}


async def _last_contact_by_customer(session, business_id: str) -> dict[str, datetime]:
    result = await session.execute(
        select(ReminderLog.customer_id, func.max(ReminderLog.sent_at))
        .where(ReminderLog.business_id == business_id)
        .group_by(ReminderLog.customer_id)
    )
    return {row[0]: row[1] for row in result.all()}


def _status_chip(
    *,
    written_off: bool,
    on_hold: bool,
    balance_minor: int,
    invoices: list[OpenInvoice],
    now: datetime,
) -> str:
    if written_off:
        return "written_off"
    if on_hold:
        return "on_hold"
    if balance_minor <= 0:
        return "current"
    worst_days_overdue = max((_days_overdue(inv.due_date_at, now) for inv in invoices), default=0)
    if worst_days_overdue > 0:
        return "overdue"
    soonest_due = min(
        (inv.due_date_at for inv in invoices if inv.due_date_at is not None), default=None
    )
    if soonest_due is not None and (soonest_due.date() - now.date()).days <= DUE_SOON_DAYS:
        return "due_soon"
    return "current"


async def _customer_account_out(
    customer: Customer,
    balance: CustomerBalance | None,
    invoices: list[OpenInvoice],
    now: datetime,
    last_payment_at: datetime | None,
    last_contact_at: datetime | None,
) -> CustomerAccountOut:
    credit_limit = balance.credit_limit_minor if balance else 0
    balance_minor = balance.balance_minor if balance else 0
    written_off = balance.written_off if balance else False
    oldest_unpaid_at = balance.oldest_unpaid_at if balance else None
    limit_used = int((balance_minor / credit_limit) * 100) if credit_limit > 0 else 0
    return CustomerAccountOut(
        id=customer.id,
        name=customer.name,
        phone=customer.phone,
        balance_minor=balance_minor,
        oldest_unpaid_days=(
            (now.date() - oldest_unpaid_at.date()).days if oldest_unpaid_at else None
        ),
        credit_limit_minor=credit_limit,
        limit_used_percent=limit_used,
        last_payment_at=last_payment_at.isoformat() if last_payment_at else None,
        last_contacted_at=last_contact_at.isoformat() if last_contact_at else None,
        status=_status_chip(
            written_off=written_off,
            on_hold=customer.status == "on_hold",
            balance_minor=balance_minor,
            invoices=invoices,
            now=now,
        ),
    )


# --- header band ------------------------------------------------------------


@router.get("/header", response_model=DebtHeaderOut)
async def get_debt_header(
    ctx: RequestContext = Depends(require_capability("report.view")),
) -> DebtHeaderOut:
    now = datetime.now(UTC)
    by_customer = await _open_invoices_for_business(ctx.session, ctx.business_id)

    balances_result = await ctx.session.execute(
        select(CustomerBalance).where(CustomerBalance.business_id == ctx.business_id)
    )
    owed_to_you = sum(
        max(b.balance_minor, 0) for b in balances_result.scalars() if not b.written_off
    )

    bucket_totals: dict[str, int] = {"current": 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0}
    due_this_week_minor = 0
    for invoices in by_customer.values():
        for inv in invoices:
            days = _days_overdue(inv.due_date_at, now)
            bucket_totals[_ageing_bucket(days)] += inv.remaining_minor
            if (
                days == 0
                and inv.due_date_at is not None
                and 0 <= (inv.due_date_at.date() - now.date()).days <= DUE_SOON_DAYS
            ):
                due_this_week_minor += inv.remaining_minor

    overdue_minor = sum(v for k, v in bucket_totals.items() if k != "current")

    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    collected_result = await ctx.session.execute(
        select(Event.payload).where(
            Event.business_id == ctx.business_id,
            Event.type == "PAYMENT_RECEIVED",
            Event.occurred_at >= month_start,
        )
    )
    collected_this_month_minor = sum(
        int(payload["amount_minor"]) for (payload,) in collected_result.all()
    )

    return DebtHeaderOut(
        owed_to_you_minor=owed_to_you,
        overdue_minor=overdue_minor,
        due_this_week_minor=due_this_week_minor,
        collected_this_month_minor=collected_this_month_minor,
        ageing=[AgeingBucketOut(bucket=k, amount_minor=v) for k, v in bucket_totals.items()],
    )


# --- accounts table / drawer -------------------------------------------------


@router.get("/accounts", response_model=list[CustomerAccountOut])
async def list_debt_accounts(
    ctx: RequestContext = Depends(require_capability("report.view")),
) -> list[CustomerAccountOut]:
    now = datetime.now(UTC)
    customers_result = await ctx.session.execute(
        select(Customer).where(Customer.business_id == ctx.business_id).order_by(Customer.name)
    )
    customers = list(customers_result.scalars())

    balances_result = await ctx.session.execute(
        select(CustomerBalance).where(CustomerBalance.business_id == ctx.business_id)
    )
    balance_by_customer = {b.customer_id: b for b in balances_result.scalars()}

    invoices_by_customer = await _open_invoices_for_business(ctx.session, ctx.business_id)
    last_payment_by_customer = await _last_payment_by_customer(ctx.session, ctx.business_id)
    last_contact_by_customer = await _last_contact_by_customer(ctx.session, ctx.business_id)

    return [
        await _customer_account_out(
            customer,
            balance_by_customer.get(customer.id),
            invoices_by_customer.get(customer.id, []),
            now,
            last_payment_by_customer.get(customer.id),
            last_contact_by_customer.get(customer.id),
        )
        for customer in customers
    ]


@router.get("/accounts/{customer_id}", response_model=CustomerAccountOut)
async def get_debt_account(
    customer_id: str, ctx: RequestContext = Depends(require_capability("report.view"))
) -> CustomerAccountOut:
    customer = await ctx.session.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(status_code=404, detail="Not found.")
    now = datetime.now(UTC)
    balance_result = await ctx.session.execute(
        select(CustomerBalance).where(CustomerBalance.customer_id == customer_id)
    )
    balance = balance_result.scalar_one_or_none()
    invoices = await _open_invoices_for_customer(ctx.session, ctx.business_id, customer_id)
    last_payment_by_customer = await _last_payment_by_customer(ctx.session, ctx.business_id)
    last_contact_by_customer = await _last_contact_by_customer(ctx.session, ctx.business_id)
    return await _customer_account_out(
        customer,
        balance,
        invoices,
        now,
        last_payment_by_customer.get(customer_id),
        last_contact_by_customer.get(customer_id),
    )


@router.get("/accounts/{customer_id}/invoices", response_model=list[InvoiceOut])
async def get_customer_invoices(
    customer_id: str, ctx: RequestContext = Depends(require_capability("report.view"))
) -> list[InvoiceOut]:
    now = datetime.now(UTC)
    invoices = await _open_invoices_for_customer(ctx.session, ctx.business_id, customer_id)
    out: list[InvoiceOut] = []
    for inv in invoices:
        days = _days_overdue(inv.due_date_at, now)
        out.append(
            InvoiceOut(
                sale_id=inv.sale_id,
                occurred_at=inv.occurred_at.isoformat(),
                due_date_at=inv.due_date_at.isoformat() if inv.due_date_at else None,
                total_minor=inv.total_minor,
                paid_minor=inv.allocated_minor,
                remaining_minor=inv.remaining_minor,
                days_overdue=days,
                bucket=_ageing_bucket(days),
            )
        )
    return out


@router.get("/accounts/{customer_id}/statement", response_model=list[StatementLineOut])
async def get_customer_statement(
    customer_id: str, ctx: RequestContext = Depends(require_capability("report.view"))
) -> list[StatementLineOut]:
    """Spec D.6.3: "a running account -- every credit sale and every
    payment in date order with a running balance, exactly like the paper
    book." Reads directly from the ledger (credit-bearing sales + the
    customer's PAYMENT_RECEIVED/DEBT_WRITTEN_OFF events) rather than any
    projection, since a statement is inherently a chronological replay, not
    a current-state figure."""
    sales_result = await ctx.session.execute(
        select(Sale.id, Sale.created_at, func.sum(SalePayment.amount_minor))
        .join(SalePayment, SalePayment.sale_id == Sale.id)
        .where(
            Sale.business_id == ctx.business_id,
            Sale.customer_id == customer_id,
            SalePayment.method == "credit",
        )
        .group_by(Sale.id, Sale.created_at)
    )
    lines: list[tuple[datetime, str, str, int, str]] = []
    for sale_id, created_at, credit_total in sales_result.all():
        lines.append((created_at, "sale", f"Credit sale {sale_id[:8]}", int(credit_total), sale_id))

    payment_events_result = await ctx.session.execute(
        select(Event.id, Event.occurred_at, Event.payload).where(
            Event.business_id == ctx.business_id,
            Event.type == "PAYMENT_RECEIVED",
            Event.payload["customer_id"].astext == customer_id,
        )
    )
    for event_id, occurred_at, payload in payment_events_result.all():
        lines.append(
            (
                occurred_at,
                "payment",
                f"Payment received ({payload.get('method', 'unknown')})",
                -int(payload["amount_minor"]),
                event_id,
            )
        )

    writeoff_events_result = await ctx.session.execute(
        select(Event.id, Event.occurred_at, Event.payload).where(
            Event.business_id == ctx.business_id,
            Event.type == "DEBT_WRITTEN_OFF",
            Event.payload["customer_id"].astext == customer_id,
        )
    )
    for event_id, occurred_at, payload in writeoff_events_result.all():
        lines.append(
            (occurred_at, "write_off", "Debt written off", -int(payload["amount_minor"]), event_id)
        )

    lines.sort(key=lambda line: line[0])

    running = 0
    out: list[StatementLineOut] = []
    for occurred_at, line_type, description, amount_minor, reference_id in lines:
        running += amount_minor
        out.append(
            StatementLineOut(
                occurred_at=occurred_at.isoformat(),
                type=line_type,
                description=description,
                amount_minor=amount_minor,
                running_balance_minor=running,
                reference_id=reference_id,
            )
        )
    return out


@router.get("/accounts/{customer_id}/contact-history", response_model=list[ContactHistoryEntryOut])
async def get_contact_history(
    customer_id: str, ctx: RequestContext = Depends(require_capability("report.view"))
) -> list[ContactHistoryEntryOut]:
    result = await ctx.session.execute(
        select(ReminderLog)
        .where(ReminderLog.business_id == ctx.business_id, ReminderLog.customer_id == customer_id)
        .order_by(ReminderLog.sent_at.desc())
    )
    return [
        ContactHistoryEntryOut(
            id=row.id,
            sent_at=row.sent_at.isoformat(),
            source=row.source,
            channel=row.channel,
            template_key=row.template_key,
            delivered_status=row.delivered_status,
            read_status=row.read_status,
            note=row.note,
            promise_to_pay_date=(
                row.promise_to_pay_date.isoformat() if row.promise_to_pay_date else None
            ),
        )
        for row in result.scalars()
    ]


@router.post(
    "/accounts/{customer_id}/log-call", response_model=ContactHistoryEntryOut, status_code=201
)
async def log_call(
    customer_id: str,
    body: LogCallRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("debt.contact_log")),
) -> ContactHistoryEntryOut:
    raw_body = await request.body()
    fingerprint = fingerprint_request(
        "POST", f"/api/v1/debt/accounts/{customer_id}/log-call", ctx.business_id, raw_body
    )
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint=f"POST /api/v1/debt/accounts/{customer_id}/log-call",
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
        return ContactHistoryEntryOut(**existing.response_body)

    customer = await ctx.session.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(status_code=404, detail="Not found.")

    promise_date: date | None = None
    if body.promise_to_pay_date:
        try:
            promise_date = date.fromisoformat(body.promise_to_pay_date)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Invalid promise_to_pay_date.") from exc

    row = ReminderLog(
        business_id=ctx.business_id,
        customer_id=customer_id,
        source="manual_call",
        channel="call",
        sent_at=datetime.now(UTC),
        delivered_status="n/a",
        read_status="n/a",
        note=body.note,
        promise_to_pay_date=promise_date,
        logged_by_user_id=ctx.user_id,
    )
    ctx.session.add(row)
    await ctx.session.flush()

    out = ContactHistoryEntryOut(
        id=row.id,
        sent_at=row.sent_at.isoformat(),
        source=row.source,
        channel=row.channel,
        template_key=row.template_key,
        delivered_status=row.delivered_status,
        read_status=row.read_status,
        note=row.note,
        promise_to_pay_date=(
            row.promise_to_pay_date.isoformat() if row.promise_to_pay_date else None
        ),
    )
    await complete(ctx.session, claimed_id=claimed_id, status_code=201, body=out.model_dump())
    return out


# --- take payment -------------------------------------------------------------


@router.post("/accounts/{customer_id}/take-payment", response_model=TakePaymentOut, status_code=201)
async def take_payment(
    customer_id: str,
    body: TakePaymentRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("debt.take_payment")),
) -> TakePaymentOut:
    """Spec D.6.4. One atomic transaction: resolve allocation, append
    `PAYMENT_RECEIVED`, write `payment_allocations` -- all or nothing. See
    module docstring for the atomicity guarantee this relies on."""
    raw_body = await request.body()
    fingerprint = fingerprint_request(
        "POST", f"/api/v1/debt/accounts/{customer_id}/take-payment", ctx.business_id, raw_body
    )
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint=f"POST /api/v1/debt/accounts/{customer_id}/take-payment",
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
        return TakePaymentOut(**existing.response_body)

    customer = await ctx.session.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(status_code=404, detail="Not found.")

    if body.amount_minor <= 0:
        raise HTTPException(status_code=422, detail="amount_minor must be positive.")
    if body.method not in VALID_PAYMENT_METHODS:
        raise HTTPException(status_code=422, detail=f"Unknown payment method {body.method!r}.")

    now = datetime.now(UTC)
    occurred_at = now
    if body.received_at:
        try:
            occurred_at = datetime.fromisoformat(body.received_at)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Invalid received_at.") from exc
        if occurred_at.tzinfo is None:
            occurred_at = occurred_at.replace(tzinfo=UTC)
        if occurred_at.date() < now.date():
            if not ctx.capabilities.has("debt.back_date_payment", location_id=None):
                raise HTTPException(
                    status_code=403,
                    detail="Back-dating a payment requires the debt.back_date_payment permission.",
                )
            if not body.back_date_reason:
                raise HTTPException(
                    status_code=422, detail="A reason is required to back-date a payment."
                )

    open_invoices = await _open_invoices_for_customer(ctx.session, ctx.business_id, customer_id)

    allocations: list[tuple[str, int]] = []
    if body.allocation_mode == "auto":
        auto_allocations, unallocated = auto_allocate(open_invoices, body.amount_minor)
        allocations = auto_allocations
        if unallocated > 0:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Payment of {body.amount_minor} exceeds this customer's total open invoice "
                    f"balance -- reduce the amount or allocate manually."
                ),
            )
    elif body.allocation_mode == "manual":
        if not body.manual_allocations:
            raise HTTPException(
                status_code=422, detail="manual_allocations is required for manual allocation."
            )
        remaining_by_sale = {inv.sale_id: inv.remaining_minor for inv in open_invoices}
        total_allocated = 0
        for line in body.manual_allocations:
            invoice_remaining = remaining_by_sale.get(line.sale_id)
            if invoice_remaining is None:
                raise HTTPException(
                    status_code=422,
                    detail=f"Sale {line.sale_id} is not an open invoice for this customer.",
                )
            if line.amount_minor <= 0 or line.amount_minor > invoice_remaining:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"Allocation of {line.amount_minor} to sale {line.sale_id} is invalid "
                        f"(that invoice has {invoice_remaining} remaining)."
                    ),
                )
            allocations.append((line.sale_id, line.amount_minor))
            total_allocated += line.amount_minor
        if total_allocated != body.amount_minor:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Manual allocations total {total_allocated} but the payment amount is "
                    f"{body.amount_minor} -- they must match exactly."
                ),
            )
    else:
        raise HTTPException(status_code=422, detail="allocation_mode must be 'auto' or 'manual'.")

    money_location = payment_method_account_key(body.method)

    try:
        event = await append_event(
            ctx.session,
            EventEnvelopeInput(
                business_id=ctx.business_id,
                type="PAYMENT_RECEIVED",
                payload={
                    "customer_id": customer_id,
                    "amount_minor": body.amount_minor,
                    "method": body.method,
                    "money_location": money_location,
                    "reference": body.reference,
                },
                actor_user_id=ctx.user_id,
                actor_source="api",
                location_id=body.location_id,
                occurred_at=occurred_at,
            ),
        )
    except EnvelopeValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    for sale_id, amount_minor in allocations:
        ctx.session.add(
            PaymentAllocation(
                business_id=ctx.business_id,
                payment_event_id=event.id,
                sale_id=sale_id,
                amount_minor=amount_minor,
            )
        )
    await ctx.session.flush()

    balance_result = await ctx.session.execute(
        select(CustomerBalance).where(CustomerBalance.customer_id == customer_id)
    )
    balance = balance_result.scalar_one_or_none()

    if body.send_receipt and customer.phone:
        await get_notification_sender().send(
            channel="whatsapp",
            to=customer.phone,
            subject="Payment received",
            body=f"We received your payment of {body.amount_minor} minor units. Thank you.",
        )

    out = TakePaymentOut(
        payment_event_id=event.id,
        customer_id=customer_id,
        amount_minor=body.amount_minor,
        allocations=[AllocationOut(sale_id=sid, amount_minor=amt) for sid, amt in allocations],
        customer_balance_minor=balance.balance_minor if balance else 0,
    )
    await complete(ctx.session, claimed_id=claimed_id, status_code=201, body=out.model_dump())
    return out


# --- write-off ------------------------------------------------------------


@router.post("/accounts/{customer_id}/write-off", response_model=WriteOffOut, status_code=201)
async def write_off_debt(
    customer_id: str,
    body: WriteOffRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("debt.write_off")),
) -> WriteOffOut:
    """Spec D.6.6: permission-gated (via `debt.write_off`, Phase 0's
    existing capability) plus, above a threshold, the caller must type the
    exact customer name as an extra confirmation step."""
    raw_body = await request.body()
    fingerprint = fingerprint_request(
        "POST", f"/api/v1/debt/accounts/{customer_id}/write-off", ctx.business_id, raw_body
    )
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint=f"POST /api/v1/debt/accounts/{customer_id}/write-off",
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
        return WriteOffOut(**existing.response_body)

    customer = await ctx.session.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(status_code=404, detail="Not found.")
    if not body.reason:
        raise HTTPException(status_code=422, detail="A reason is required to write off debt.")

    balance_result = await ctx.session.execute(
        select(CustomerBalance).where(CustomerBalance.customer_id == customer_id)
    )
    balance = balance_result.scalar_one_or_none()
    current_balance = balance.balance_minor if balance else 0
    if current_balance <= 0:
        raise HTTPException(status_code=422, detail="This customer has no outstanding debt.")

    if (
        current_balance >= WRITE_OFF_NAME_CONFIRM_THRESHOLD_MINOR
        and body.confirm_customer_name != customer.name
    ):
        raise HTTPException(
            status_code=422,
            detail="Type the customer's exact name to confirm a write-off this large.",
        )

    try:
        event = await append_event(
            ctx.session,
            EventEnvelopeInput(
                business_id=ctx.business_id,
                type="DEBT_WRITTEN_OFF",
                payload={
                    "customer_id": customer_id,
                    "amount_minor": current_balance,
                    "reason": body.reason,
                },
                actor_user_id=ctx.user_id,
                actor_source="api",
            ),
        )
    except EnvelopeValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    out = WriteOffOut(
        customer_id=customer_id,
        amount_written_off_minor=current_balance,
        written_off_at=event.occurred_at.isoformat(),
    )
    await complete(ctx.session, claimed_id=claimed_id, status_code=201, body=out.model_dump())
    return out


# --- who to chase today ------------------------------------------------------


@router.get("/queue", response_model=list[ChaseQueueEntryOut])
async def get_chase_queue(
    ctx: RequestContext = Depends(require_capability("report.view")),
) -> list[ChaseQueueEntryOut]:
    """Spec D.6.7: "scoring each account by amount x days overdue x payment
    reliability history." Payment-reliability history is not modelled this
    phase (no per-customer on-time/late payment tally exists yet) -- score
    here is amount_overdue x days_overdue, a documented simplification of
    the full spec formula (docs/DECISIONS.md), not the complete signal.
    """
    now = datetime.now(UTC)
    by_customer = await _open_invoices_for_business(ctx.session, ctx.business_id)

    customers_result = await ctx.session.execute(
        select(Customer).where(Customer.business_id == ctx.business_id)
    )
    customers = {c.id: c for c in customers_result.scalars()}

    balances_result = await ctx.session.execute(
        select(CustomerBalance).where(CustomerBalance.business_id == ctx.business_id)
    )
    balances = {b.customer_id: b for b in balances_result.scalars()}

    entries: list[ChaseQueueEntryOut] = []
    for customer_id, invoices in by_customer.items():
        customer = customers.get(customer_id)
        balance = balances.get(customer_id)
        if customer is None or balance is None or balance.written_off:
            continue
        if customer.status == "on_hold":
            continue
        overdue_amount = 0
        max_days = 0
        for inv in invoices:
            days = _days_overdue(inv.due_date_at, now)
            if days > 0:
                overdue_amount += inv.remaining_minor
                max_days = max(max_days, days)
        if overdue_amount <= 0:
            continue
        entries.append(
            ChaseQueueEntryOut(
                customer_id=customer_id,
                name=customer.name,
                phone=customer.phone,
                balance_minor=balance.balance_minor,
                days_overdue=max_days,
                score=overdue_amount * max_days,
            )
        )

    entries.sort(key=lambda e: e.score, reverse=True)
    return entries[:50]


# --- pay link (spec D.6.5, plan §0.5) ----------------------------------------


@router.post("/accounts/{customer_id}/pay-link", response_model=PayLinkCreateOut, status_code=201)
async def create_pay_link(
    customer_id: str,
    body: PayLinkCreateRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("debt.send_reminder")),
) -> PayLinkCreateOut:
    """Mints a signed, single-use, expiring pay-link token (plan §0.5) for
    this customer -- `amount_minor` defaults to their current full
    balance, matching D.6.4's "amount (defaults to the full balance)" take-
    payment default. The full reminder-engine auto-inclusion of a pay link
    in every scheduled message (D.6.5) lands with the reminder scheduling
    work; this endpoint is the standalone "generate one now" action the
    reminder engine will call into, usable on its own already."""
    raw_body = await request.body()
    fingerprint = fingerprint_request(
        "POST", f"/api/v1/debt/accounts/{customer_id}/pay-link", ctx.business_id, raw_body
    )
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint=f"POST /api/v1/debt/accounts/{customer_id}/pay-link",
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
        return PayLinkCreateOut(**existing.response_body)

    customer = await ctx.session.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(status_code=404, detail="Not found.")

    amount_minor = body.amount_minor
    if amount_minor is None:
        balance_result = await ctx.session.execute(
            select(CustomerBalance).where(CustomerBalance.customer_id == customer_id)
        )
        balance = balance_result.scalar_one_or_none()
        amount_minor = balance.balance_minor if balance else 0
    if amount_minor <= 0:
        raise HTTPException(status_code=422, detail="This customer has no positive balance to pay.")

    expires_at = datetime.now(UTC) + timedelta(days=body.expires_in_days)
    pay_link = PayLink(
        business_id=ctx.business_id,
        location_id=body.location_id,
        customer_id=customer_id,
        amount_minor=amount_minor,
        allocation_hint="auto",
        expires_at=expires_at,
        status="pending",
    )
    ctx.session.add(pay_link)
    await ctx.session.flush()

    token = create_pay_link_token(
        pay_link_id=pay_link.id, business_id=ctx.business_id, expires_at=expires_at
    )

    out = PayLinkCreateOut(
        token=token, amount_minor=amount_minor, expires_at=expires_at.isoformat()
    )
    await complete(ctx.session, claimed_id=claimed_id, status_code=201, body=out.model_dump())
    return out
