"""Day open/close (spec D.3/D.11, plan §3).

`DAY_OPENED`'s `expected_amount_minor` is the previous closed day's counted
figure for the same location (spec D.3: "Closed yesterday at 8:14pm with
RWF 340,500 in the till"), or 0 for a location's first-ever day.
`DAY_CLOSED`'s `expected_amount_minor` is the location's live "till"
`money_location_balance` right before close -- that account already reflects
the opening count plus every cash sale payment recorded since (see
projections/money_location_balance.py), so it IS the system's running
belief about cash on hand; the counted figure is what a human found for
real. Both write a plain `DaySession` row directly (not a projection) and
append the corresponding event in the same transaction.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select

from operatoros_api.api.deps import (
    RequestContext,
    get_current_context,
    idempotency_key_header,
    require_capability,
)
from operatoros_api.idempotency_service import (
    claim_or_replay,
    complete,
    fingerprint_request,
    get_existing,
)
from operatoros_api.ledger import EnvelopeValidationError, EventEnvelopeInput, append_event
from operatoros_api.models.day_till import DaySession
from operatoros_api.models.projections import DailyTotals, MoneyLocationBalance
from operatoros_api.schemas.day_till import DayCloseRequest, DayOpenRequest, DaySessionOut

router = APIRouter(prefix="/api/v1/day", tags=["day"])


def _to_day_session_out(day: DaySession) -> DaySessionOut:
    return DaySessionOut(
        id=day.id,
        location_id=day.location_id,
        business_date=day.business_date.isoformat(),
        status=day.status,
        opened_at=day.opened_at.isoformat(),
        opening_counted_amount_minor=day.opening_counted_amount_minor,
        opening_expected_amount_minor=day.opening_expected_amount_minor,
        opening_variance_minor=day.opening_variance_minor,
        closed_at=day.closed_at.isoformat() if day.closed_at else None,
        closing_counted_amount_minor=day.closing_counted_amount_minor,
        closing_expected_amount_minor=day.closing_expected_amount_minor,
        closing_variance_minor=day.closing_variance_minor,
        transaction_count=day.transaction_count,
    )


@router.get("/status", response_model=DaySessionOut | None)
async def get_day_status(
    location_id: str = Query(...), ctx: RequestContext = Depends(get_current_context)
) -> DaySessionOut | None:
    result = await ctx.session.execute(
        select(DaySession)
        .where(DaySession.location_id == location_id, DaySession.status == "open")
        .order_by(DaySession.opened_at.desc())
    )
    day = result.scalars().first()
    return _to_day_session_out(day) if day else None


@router.post("/open", response_model=DaySessionOut, status_code=201)
async def open_day(
    body: DayOpenRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("day.open")),
) -> DaySessionOut:
    raw_body = await request.body()
    fingerprint = fingerprint_request("POST", "/api/v1/day/open", ctx.business_id, raw_body)
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint="POST /api/v1/day/open",
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
        return DaySessionOut(**existing.response_body)

    open_result = await ctx.session.execute(
        select(DaySession).where(
            DaySession.location_id == body.location_id, DaySession.status == "open"
        )
    )
    if open_result.scalars().first() is not None:
        raise HTTPException(status_code=409, detail="The shop is already open at this location.")

    last_close_result = await ctx.session.execute(
        select(DaySession)
        .where(DaySession.location_id == body.location_id, DaySession.status == "closed")
        .order_by(DaySession.closed_at.desc())
    )
    last_close = last_close_result.scalars().first()
    expected = (
        last_close.closing_counted_amount_minor
        if last_close and last_close.closing_counted_amount_minor is not None
        else 0
    )
    variance = body.counted_amount_minor - expected
    if variance != 0 and not body.variance_reason:
        raise HTTPException(
            status_code=422,
            detail=f"The till doesn't match yesterday's close by {variance} minor units -- a reason is required.",
        )

    now = datetime.now(UTC)
    day = DaySession(
        business_id=ctx.business_id,
        location_id=body.location_id,
        business_date=now.date(),
        status="open",
        opened_at=now,
        opened_by_user_id=ctx.user_id,
        opening_counted_amount_minor=body.counted_amount_minor,
        opening_expected_amount_minor=expected,
        opening_variance_minor=variance,
        opening_variance_reason=body.variance_reason,
    )
    ctx.session.add(day)
    await ctx.session.flush()

    try:
        await append_event(
            ctx.session,
            EventEnvelopeInput(
                business_id=ctx.business_id,
                type="DAY_OPENED",
                payload={
                    "counted_amount_minor": body.counted_amount_minor,
                    "expected_amount_minor": expected,
                    "variance_minor": variance,
                    "variance_reason": body.variance_reason,
                },
                actor_user_id=ctx.user_id,
                actor_source="api",
                location_id=body.location_id,
            ),
        )
    except EnvelopeValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    out = _to_day_session_out(day)
    await complete(ctx.session, claimed_id=claimed_id, status_code=201, body=out.model_dump())
    return out


@router.post("/close", response_model=DaySessionOut)
async def close_day(
    body: DayCloseRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("day.close")),
) -> DaySessionOut:
    raw_body = await request.body()
    fingerprint = fingerprint_request("POST", "/api/v1/day/close", ctx.business_id, raw_body)
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint="POST /api/v1/day/close",
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
        return DaySessionOut(**existing.response_body)

    open_result = await ctx.session.execute(
        select(DaySession).where(
            DaySession.location_id == body.location_id, DaySession.status == "open"
        )
    )
    day = open_result.scalars().first()
    if day is None:
        raise HTTPException(status_code=409, detail="The shop isn't open at this location.")

    till_result = await ctx.session.execute(
        select(MoneyLocationBalance).where(
            MoneyLocationBalance.location_id == body.location_id,
            MoneyLocationBalance.account_key == "till",
        )
    )
    till_row = till_result.scalar_one_or_none()
    expected = till_row.balance_minor if till_row else 0
    variance = body.counted_amount_minor - expected
    if variance != 0 and not body.variance_reason:
        raise HTTPException(
            status_code=422,
            detail=f"The till is off by {variance} minor units against what today's sales expect -- a reason is required.",
        )

    totals_result = await ctx.session.execute(
        select(DailyTotals).where(
            DailyTotals.location_id == body.location_id,
            DailyTotals.business_date == day.business_date,
        )
    )
    totals = totals_result.scalar_one_or_none()

    now = datetime.now(UTC)
    day.status = "closed"
    day.closed_at = now
    day.closed_by_user_id = ctx.user_id
    day.closing_counted_amount_minor = body.counted_amount_minor
    day.closing_expected_amount_minor = expected
    day.closing_variance_minor = variance
    day.closing_variance_reason = body.variance_reason
    day.transaction_count = totals.transaction_count if totals else 0
    await ctx.session.flush()

    try:
        await append_event(
            ctx.session,
            EventEnvelopeInput(
                business_id=ctx.business_id,
                type="DAY_CLOSED",
                payload={
                    "counted_amount_minor": body.counted_amount_minor,
                    "expected_amount_minor": expected,
                    "variance_minor": variance,
                    "variance_reason": body.variance_reason,
                    "transaction_count": day.transaction_count,
                },
                actor_user_id=ctx.user_id,
                actor_source="api",
                location_id=body.location_id,
            ),
        )
    except EnvelopeValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    out = _to_day_session_out(day)
    await complete(ctx.session, claimed_id=claimed_id, status_code=200, body=out.model_dump())
    return out
