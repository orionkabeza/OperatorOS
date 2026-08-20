"""Till sessions (spec D.7.5, plan §3).

A till session's expected close amount is `opening_float_minor + cash sales
recorded under this till session - cash refunds against those sales` --
computed directly from `sale_payments`/`returns` (not from
`money_location_balance`, which is per-location and shared across every
cashier's till at that location, not scoped to one session).
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select

from operatoros_api.api.deps import RequestContext, idempotency_key_header, require_capability
from operatoros_api.idempotency_service import (
    claim_or_replay,
    complete,
    fingerprint_request,
    get_existing,
)
from operatoros_api.ledger import EnvelopeValidationError, EventEnvelopeInput, append_event
from operatoros_api.models.day_till import DaySession, TillSession
from operatoros_api.models.sales import Return, Sale, SalePayment
from operatoros_api.schemas.day_till import TillCloseRequest, TillOpenRequest, TillSessionOut

router = APIRouter(prefix="/api/v1/till", tags=["till"])


def _to_till_session_out(till: TillSession) -> TillSessionOut:
    return TillSessionOut(
        id=till.id,
        location_id=till.location_id,
        day_session_id=till.day_session_id,
        cashier_user_id=till.cashier_user_id,
        status=till.status,
        opened_at=till.opened_at.isoformat(),
        opening_float_minor=till.opening_float_minor,
        closed_at=till.closed_at.isoformat() if till.closed_at else None,
        closing_counted_amount_minor=till.closing_counted_amount_minor,
        closing_expected_amount_minor=till.closing_expected_amount_minor,
        closing_variance_minor=till.closing_variance_minor,
    )


@router.post("/open", response_model=TillSessionOut, status_code=201)
async def open_till(
    body: TillOpenRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("till.open")),
) -> TillSessionOut:
    raw_body = await request.body()
    fingerprint = fingerprint_request("POST", "/api/v1/till/open", ctx.business_id, raw_body)
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint="POST /api/v1/till/open",
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
        return TillSessionOut(**existing.response_body)

    day_result = await ctx.session.execute(
        select(DaySession).where(
            DaySession.location_id == body.location_id, DaySession.status == "open"
        )
    )
    day = day_result.scalars().first()
    if day is None:
        raise HTTPException(status_code=409, detail="The shop isn't open at this location yet.")

    now = datetime.now(UTC)
    till = TillSession(
        business_id=ctx.business_id,
        location_id=body.location_id,
        day_session_id=day.id,
        cashier_user_id=ctx.user_id,
        status="open",
        opened_at=now,
        opening_float_minor=body.opening_float_minor,
    )
    ctx.session.add(till)
    await ctx.session.flush()

    try:
        await append_event(
            ctx.session,
            EventEnvelopeInput(
                business_id=ctx.business_id,
                type="TILL_SESSION_OPENED",
                payload={
                    "till_session_id": till.id,
                    "opening_float_minor": body.opening_float_minor,
                    "cashier_user_id": ctx.user_id,
                },
                actor_user_id=ctx.user_id,
                actor_source="api",
                location_id=body.location_id,
            ),
        )
    except EnvelopeValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    out = _to_till_session_out(till)
    await complete(ctx.session, claimed_id=claimed_id, status_code=201, body=out.model_dump())
    return out


@router.post("/{till_session_id}/close", response_model=TillSessionOut)
async def close_till(
    till_session_id: str,
    body: TillCloseRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("till.close")),
) -> TillSessionOut:
    raw_body = await request.body()
    fingerprint = fingerprint_request(
        "POST", f"/api/v1/till/{till_session_id}/close", ctx.business_id, raw_body
    )
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint=f"POST /api/v1/till/{till_session_id}/close",
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
        return TillSessionOut(**existing.response_body)

    till = await ctx.session.get(TillSession, till_session_id)
    if till is None or till.status != "open":
        raise HTTPException(status_code=409, detail="This till session isn't open.")

    cash_sales_result = await ctx.session.execute(
        select(func.coalesce(func.sum(SalePayment.amount_minor), 0))
        .select_from(SalePayment)
        .join(Sale, Sale.id == SalePayment.sale_id)
        .where(Sale.till_session_id == till_session_id, SalePayment.method == "cash")
    )
    cash_sales = int(cash_sales_result.scalar_one())

    cash_refunds_result = await ctx.session.execute(
        select(func.coalesce(func.sum(Return.refund_amount_minor), 0))
        .select_from(Return)
        .join(Sale, Sale.id == Return.sale_id)
        .where(Sale.till_session_id == till_session_id, Return.refund_method == "cash")
    )
    cash_refunds = int(cash_refunds_result.scalar_one())

    expected = till.opening_float_minor + cash_sales - cash_refunds
    variance = body.counted_amount_minor - expected

    now = datetime.now(UTC)
    till.status = "closed"
    till.closed_at = now
    till.closing_counted_amount_minor = body.counted_amount_minor
    till.closing_expected_amount_minor = expected
    till.closing_variance_minor = variance
    await ctx.session.flush()

    try:
        await append_event(
            ctx.session,
            EventEnvelopeInput(
                business_id=ctx.business_id,
                type="TILL_SESSION_CLOSED",
                payload={
                    "till_session_id": till.id,
                    "counted_amount_minor": body.counted_amount_minor,
                    "expected_amount_minor": expected,
                    "variance_minor": variance,
                },
                actor_user_id=ctx.user_id,
                actor_source="api",
                location_id=till.location_id,
            ),
        )
    except EnvelopeValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    out = _to_till_session_out(till)
    await complete(ctx.session, claimed_id=claimed_id, status_code=200, body=out.model_dump())
    return out
