"""The Cash Box (spec D.7.1/D.7.2, plan §3): "where is my money?" across
till/MoMo/bank -- the balances band, the money movements table, and
manual balance corrections for unconnected ("Manual") accounts.

**Manual balance corrections reuse `MONEY_TRANSFERRED`, against a virtual
`manual_adjustment` counterparty account, rather than a new event type.**
`events_registry.py` is fixed this phase (plan's own framing throughout);
there is no `BALANCE_ADJUSTED`/`BALANCE_CORRECTED` event to represent "a
human recounted/re-synced this account to a new absolute figure" the way
`DAY_OPENED`/`DAY_CLOSED` already do specifically for the till account.
`MONEY_TRANSFERRED` is the existing primitive whose actual semantics
("moves money between two named accounts at a location") are the closest
honest fit: a correction of +5,000 to the MoMo balance is modelled as
5,000 moving FROM `manual_adjustment` TO `momo`, and a correction of
-5,000 the reverse. `manual_adjustment` never appears in the balances band
(the balances endpoint only ever surfaces the account keys a `MoneyLocation`
row or a real payment/expense would produce) -- it exists purely as the
double-entry counterparty so `money_location_balance`'s existing handler
needs no new logic. Documented in docs/DECISIONS.md.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select

from operatoros_api.api.deps import RequestContext, idempotency_key_header, require_capability
from operatoros_api.idempotency_service import (
    claim_or_replay,
    complete,
    fingerprint_request,
    get_existing,
)
from operatoros_api.ledger import EnvelopeValidationError, EventEnvelopeInput, append_event
from operatoros_api.models.events import Event
from operatoros_api.models.money_locations import MoneyLocation
from operatoros_api.models.projections import MoneyLocationBalance
from operatoros_api.schemas.cashbox import (
    BalanceCardOut,
    MoneyLocationCreate,
    MoneyLocationOut,
    MoneyMovementOut,
    UpdateBalanceRequest,
)

router = APIRouter(prefix="/api/v1/cashbox", tags=["cashbox"])

MANUAL_ADJUSTMENT_ACCOUNT_KEY = "manual_adjustment"

_DEFAULT_DISPLAY_NAMES = {
    "till": "TILL",
    "momo": "MTN MOMO",
    "airtel": "AIRTEL MONEY",
    "bank": "BANK",
    "card": "CARD",
    "cheque": "CHEQUE",
}

_MOVEMENT_TYPE_LABELS = {
    "SALE_RECORDED": "Sale",
    "PAYMENT_RECEIVED": "Debt payment",
    "EXPENSE_RECORDED": "Expense",
    "MONEY_TRANSFERRED": "Transfer",
    "DAY_OPENED": "Day opened (count)",
    "DAY_CLOSED": "Day closed (count)",
}


@router.get("/balances", response_model=list[BalanceCardOut])
async def get_balances(
    location_id: str, ctx: RequestContext = Depends(require_capability("report.view"))
) -> list[BalanceCardOut]:
    now = datetime.now(UTC)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    balances_result = await ctx.session.execute(
        select(MoneyLocationBalance).where(MoneyLocationBalance.location_id == location_id)
    )
    balances = [
        b for b in balances_result.scalars() if b.account_key != MANUAL_ADJUSTMENT_ACCOUNT_KEY
    ]

    metadata_result = await ctx.session.execute(
        select(MoneyLocation).where(MoneyLocation.location_id == location_id)
    )
    metadata_by_key = {m.account_key: m for m in metadata_result.scalars()}

    cards: list[BalanceCardOut] = []
    for balance in balances:
        meta = metadata_by_key.get(balance.account_key)
        today_movement = await _today_movement(
            ctx.session, location_id, balance.account_key, today_start
        )
        cards.append(
            BalanceCardOut(
                location_id=location_id,
                account_key=balance.account_key,
                display_name=(
                    meta.display_name
                    if meta
                    else _DEFAULT_DISPLAY_NAMES.get(
                        balance.account_key, balance.account_key.upper()
                    )
                ),
                masked_account_number=meta.masked_account_number if meta else None,
                kind=meta.kind if meta else balance.account_key,
                connection_status=meta.connection_status if meta else "manual",
                last_synced_at=(
                    meta.last_synced_at.isoformat() if meta and meta.last_synced_at else None
                ),
                balance_minor=balance.balance_minor,
                today_movement_minor=today_movement,
            )
        )
    return cards


async def _today_movement(
    session, location_id: str, account_key: str, today_start: datetime
) -> int:
    """Sums today's ins/outs for one account from the event log directly
    -- `money_location_balance` only ever holds the current total, not a
    daily delta, so "today's movement beneath the balance" (D.7.1) has to
    be computed, not read off the projection."""
    result = await session.execute(
        select(Event).where(
            Event.location_id == location_id,
            Event.occurred_at >= today_start,
            Event.type.in_(
                ["SALE_RECORDED", "EXPENSE_RECORDED", "MONEY_TRANSFERRED", "PAYMENT_RECEIVED"]
            ),
        )
    )
    net = 0
    for event in result.scalars():
        payload = event.payload
        if event.type == "SALE_RECORDED":
            for pay in payload["payments"]:
                if pay["method"] == "credit":
                    continue
                key = "till" if pay["method"] == "cash" else pay["method"]
                if key == account_key:
                    net += int(pay["amount_minor"])
        elif event.type == "EXPENSE_RECORDED":
            if payload["money_location"] == account_key:
                net -= int(payload["amount_minor"])
        elif event.type == "PAYMENT_RECEIVED":
            if payload["money_location"] == account_key:
                net += int(payload["amount_minor"])
        elif event.type == "MONEY_TRANSFERRED":
            if payload["from_money_location"] == account_key:
                net -= int(payload["amount_minor"])
            if payload["to_money_location"] == account_key:
                net += int(payload["amount_minor"])
    return net


@router.get("/movements", response_model=list[MoneyMovementOut])
async def get_movements(
    location_id: str,
    days: int = 30,
    ctx: RequestContext = Depends(require_capability("report.view")),
) -> list[MoneyMovementOut]:
    since = datetime.now(UTC) - timedelta(days=days)
    result = await ctx.session.execute(
        select(Event)
        .where(
            Event.location_id == location_id,
            Event.occurred_at >= since,
            Event.type.in_(list(_MOVEMENT_TYPE_LABELS.keys())),
        )
        .order_by(Event.occurred_at.desc())
    )
    movements: list[MoneyMovementOut] = []
    for event in result.scalars():
        movements.extend(_movement_rows(event))
    return movements


def _movement_rows(event: Event) -> list[MoneyMovementOut]:
    payload = event.payload
    label = _MOVEMENT_TYPE_LABELS.get(event.type, event.type)
    rows: list[MoneyMovementOut] = []
    if event.type == "SALE_RECORDED":
        for pay in payload["payments"]:
            if pay["method"] == "credit":
                continue
            key = "till" if pay["method"] == "cash" else pay["method"]
            rows.append(
                MoneyMovementOut(
                    occurred_at=event.occurred_at.isoformat(),
                    type=label,
                    description=f"Sale {payload['sale_id'][:8]}",
                    location_id=event.location_id or "",
                    account_key=key,
                    in_minor=int(pay["amount_minor"]),
                    out_minor=0,
                    user_id=event.actor_user_id,
                    reference=payload.get("sale_id"),
                )
            )
    elif event.type == "PAYMENT_RECEIVED":
        rows.append(
            MoneyMovementOut(
                occurred_at=event.occurred_at.isoformat(),
                type=label,
                description=f"Payment received ({payload.get('method', 'unknown')})",
                location_id=event.location_id or "",
                account_key=payload["money_location"],
                in_minor=int(payload["amount_minor"]),
                out_minor=0,
                user_id=event.actor_user_id,
                reference=payload.get("reference"),
            )
        )
    elif event.type == "EXPENSE_RECORDED":
        rows.append(
            MoneyMovementOut(
                occurred_at=event.occurred_at.isoformat(),
                type=label,
                description=f"{payload['category']}"
                + (f" -- {payload['payee']}" if payload.get("payee") else ""),
                location_id=event.location_id or "",
                account_key=payload["money_location"],
                in_minor=0,
                out_minor=int(payload["amount_minor"]),
                user_id=event.actor_user_id,
                reference=None,
            )
        )
    elif event.type == "MONEY_TRANSFERRED":
        amount = int(payload["amount_minor"])
        rows.append(
            MoneyMovementOut(
                occurred_at=event.occurred_at.isoformat(),
                type=label,
                description=payload.get("note") or "Transfer",
                location_id=event.location_id or "",
                account_key=payload["from_money_location"],
                in_minor=0,
                out_minor=amount,
                user_id=event.actor_user_id,
                reference=None,
            )
        )
        rows.append(
            MoneyMovementOut(
                occurred_at=event.occurred_at.isoformat(),
                type=label,
                description=payload.get("note") or "Transfer",
                location_id=event.location_id or "",
                account_key=payload["to_money_location"],
                in_minor=amount,
                out_minor=0,
                user_id=event.actor_user_id,
                reference=None,
            )
        )
    elif event.type in ("DAY_OPENED", "DAY_CLOSED"):
        rows.append(
            MoneyMovementOut(
                occurred_at=event.occurred_at.isoformat(),
                type=label,
                description=f"Counted {payload['counted_amount_minor']}",
                location_id=event.location_id or "",
                account_key="till",
                in_minor=0,
                out_minor=0,
                user_id=event.actor_user_id,
                reference=None,
            )
        )
    return rows


# --- money location metadata (display cards) --------------------------------


@router.post("/money-locations", response_model=MoneyLocationOut, status_code=201)
async def create_money_location(
    body: MoneyLocationCreate,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("cashbox.manage")),
) -> MoneyLocationOut:
    raw_body = await request.body()
    fingerprint = fingerprint_request(
        "POST", "/api/v1/cashbox/money-locations", ctx.business_id, raw_body
    )
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint="POST /api/v1/cashbox/money-locations",
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
        return MoneyLocationOut(**existing.response_body)

    ml = MoneyLocation(
        business_id=ctx.business_id,
        location_id=body.location_id,
        account_key=body.account_key,
        display_name=body.display_name,
        masked_account_number=body.masked_account_number,
        kind=body.kind,
        connection_status="manual",
    )
    ctx.session.add(ml)
    await ctx.session.flush()

    out = MoneyLocationOut(
        id=ml.id,
        location_id=ml.location_id,
        account_key=ml.account_key,
        display_name=ml.display_name,
        masked_account_number=ml.masked_account_number,
        kind=ml.kind,
        connection_status=ml.connection_status,
        last_synced_at=None,
    )
    await complete(ctx.session, claimed_id=claimed_id, status_code=201, body=out.model_dump())
    return out


@router.post("/money-locations/{money_location_id}/update-balance", response_model=BalanceCardOut)
async def update_balance(
    money_location_id: str,
    body: UpdateBalanceRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("cashbox.manage")),
) -> BalanceCardOut:
    raw_body = await request.body()
    fingerprint = fingerprint_request(
        "POST",
        f"/api/v1/cashbox/money-locations/{money_location_id}/update-balance",
        ctx.business_id,
        raw_body,
    )
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint=f"POST /api/v1/cashbox/money-locations/{money_location_id}/update-balance",
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
        return BalanceCardOut(**existing.response_body)

    ml = await ctx.session.get(MoneyLocation, money_location_id)
    if ml is None:
        raise HTTPException(status_code=404, detail="Not found.")

    balance_result = await ctx.session.execute(
        select(MoneyLocationBalance).where(
            MoneyLocationBalance.location_id == ml.location_id,
            MoneyLocationBalance.account_key == ml.account_key,
        )
    )
    balance = balance_result.scalar_one_or_none()
    current = balance.balance_minor if balance else 0
    delta = body.new_balance_minor - current

    if delta != 0:
        from_key = MANUAL_ADJUSTMENT_ACCOUNT_KEY if delta > 0 else ml.account_key
        to_key = ml.account_key if delta > 0 else MANUAL_ADJUSTMENT_ACCOUNT_KEY
        try:
            await append_event(
                ctx.session,
                EventEnvelopeInput(
                    business_id=ctx.business_id,
                    type="MONEY_TRANSFERRED",
                    payload={
                        "from_money_location": from_key,
                        "to_money_location": to_key,
                        "amount_minor": abs(delta),
                        "note": body.note or "Manual balance update",
                    },
                    actor_user_id=ctx.user_id,
                    actor_source="api",
                    location_id=ml.location_id,
                ),
            )
        except EnvelopeValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    ml.last_synced_at = datetime.now(UTC)
    await ctx.session.flush()

    balance_result = await ctx.session.execute(
        select(MoneyLocationBalance).where(
            MoneyLocationBalance.location_id == ml.location_id,
            MoneyLocationBalance.account_key == ml.account_key,
        )
    )
    updated_balance = balance_result.scalar_one()

    out = BalanceCardOut(
        location_id=ml.location_id,
        account_key=ml.account_key,
        display_name=ml.display_name,
        masked_account_number=ml.masked_account_number,
        kind=ml.kind,
        connection_status=ml.connection_status,
        last_synced_at=ml.last_synced_at.isoformat() if ml.last_synced_at else None,
        balance_minor=updated_balance.balance_minor,
        today_movement_minor=0,
    )
    await complete(ctx.session, claimed_id=claimed_id, status_code=200, body=out.model_dump())
    return out
