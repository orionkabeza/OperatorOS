"""The event ledger's HTTP surface: append + a read of the one wired
projection (money_location_balance)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select

from operatoros_api.api.deps import RequestContext, get_current_context, idempotency_key_header
from operatoros_api.idempotency_service import claim_or_replay, complete, fingerprint_request, get_existing
from operatoros_api.ledger import EnvelopeValidationError, EventEnvelopeInput, append_event
from operatoros_api.models.projections import MoneyLocationBalance
from operatoros_api.schemas.events import EventAppendRequest, EventOut, MoneyLocationBalanceOut

router = APIRouter(prefix="/api/v1/events", tags=["events"])


@router.post("", response_model=EventOut, status_code=201)
async def append_event_endpoint(
    body: EventAppendRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(get_current_context),
) -> EventOut:
    raw_body = await request.body()
    fingerprint = fingerprint_request("POST", "/api/v1/events", ctx.business_id, raw_body)
    claimed_id = await claim_or_replay(
        ctx.session, business_id=ctx.business_id, key=idempotency_key,
        endpoint="POST /api/v1/events", fingerprint=fingerprint,
    )
    if claimed_id is None:
        existing = await get_existing(ctx.session, business_id=ctx.business_id, key=idempotency_key)
        if existing.request_fingerprint != fingerprint:
            raise HTTPException(
                status_code=409, detail="This Idempotency-Key was already used for a different request."
            )
        return EventOut(**existing.response_body)

    envelope = EventEnvelopeInput(
        business_id=ctx.business_id,
        type=body.type,
        payload=body.payload,
        actor_user_id=ctx.user_id,
        actor_source="api",
        location_id=body.location_id,
        device_id=ctx.device_id,
        correlation_id=body.correlation_id,
        occurred_at=body.occurred_at,
        reverses_event_id=body.reverses_event_id,
        corrects_event_id=body.corrects_event_id,
    )
    try:
        event = await append_event(ctx.session, envelope)
    except EnvelopeValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    out = EventOut(
        id=event.id, type=event.type, business_id=event.business_id, location_id=event.location_id,
        occurred_at=event.occurred_at, recorded_at=event.recorded_at,
        correlation_id=event.correlation_id, schema_version=event.schema_version,
    )
    await complete(ctx.session, claimed_id=claimed_id, status_code=201, body=out.model_dump(mode="json"))
    return out


@router.get("/money-locations/{location_id}", response_model=list[MoneyLocationBalanceOut])
async def list_money_location_balances(
    location_id: str, ctx: RequestContext = Depends(get_current_context)
) -> list[MoneyLocationBalanceOut]:
    result = await ctx.session.execute(
        select(MoneyLocationBalance).where(MoneyLocationBalance.location_id == location_id)
    )
    return [
        MoneyLocationBalanceOut(
            location_id=r.location_id, account_key=r.account_key,
            balance_minor=r.balance_minor, currency=r.currency,
        )
        for r in result.scalars()
    ]
