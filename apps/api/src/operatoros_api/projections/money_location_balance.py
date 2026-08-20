"""The one real, end-to-end projection Phase 0 proves the machinery with.

Driven by two event types: `MONEY_TRANSFERRED` (moves money between two
named accounts at a location — e.g. till -> bank) and `EXPENSE_RECORDED`
(money leaves one account). Both require `location_id` on the envelope.

Plan §2 extends this projection with two more event types:

- `SALE_RECORDED` — every non-`credit` payment line moves real money into
  the account named by its payment method (`account_key = method`: "cash",
  "momo", "airtel", "bank", "card", "cheque"). A `credit` line moves no
  money here at all — it is entirely `customer_balance`'s concern
  (projections/customer_balance.py).
- `DAY_OPENED`/`DAY_CLOSED` — the counted-cash figure from a physical till
  count is a correction-to-truth, not a delta: it directly SETS the "till"
  account's balance to `counted_amount_minor`, rather than adjusting it by
  some computed amount. This is a deliberate choice (docs/DECISIONS.md):
  the whole point of the open/close ritual (spec D.3/D.11) is that a human
  physically counted real cash and that count is authoritative over
  whatever the ledger's running total says — the same reason a bank
  reconciliation corrects to the statement, not the other way around. Using
  it as a correction also means any till drift from an untracked cash
  movement never compounds past one business day.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from operatoros_api.models.events import Event
from operatoros_api.models.projections import MoneyLocationBalance
from operatoros_api.projections.framework import register_projection


async def _get_or_create_locked(
    session: AsyncSession, business_id: str, location_id: str, account_key: str
) -> MoneyLocationBalance:
    result = await session.execute(
        select(MoneyLocationBalance)
        .where(
            MoneyLocationBalance.business_id == business_id,
            MoneyLocationBalance.location_id == location_id,
            MoneyLocationBalance.account_key == account_key,
        )
        .with_for_update()
    )
    row = result.scalar_one_or_none()
    if row is None:
        row = MoneyLocationBalance(
            business_id=business_id,
            location_id=location_id,
            account_key=account_key,
            balance_minor=0,
        )
        session.add(row)
        await session.flush()
    return row


@register_projection("MONEY_TRANSFERRED")
async def on_money_transferred(session: AsyncSession, event: Event) -> None:
    if event.location_id is None:
        raise ValueError("MONEY_TRANSFERRED requires location_id on the envelope.")
    payload = event.payload
    from_row = await _get_or_create_locked(
        session, event.business_id, event.location_id, payload["from_money_location"]
    )
    to_row = await _get_or_create_locked(
        session, event.business_id, event.location_id, payload["to_money_location"]
    )
    amount = int(payload["amount_minor"])
    from_row.balance_minor -= amount
    to_row.balance_minor += amount
    from_row.last_event_id = event.id
    to_row.last_event_id = event.id
    from_row.updated_at_ledger = event.occurred_at
    to_row.updated_at_ledger = event.occurred_at


@register_projection("EXPENSE_RECORDED")
async def on_expense_recorded(session: AsyncSession, event: Event) -> None:
    if event.location_id is None:
        raise ValueError("EXPENSE_RECORDED requires location_id on the envelope.")
    payload = event.payload
    row = await _get_or_create_locked(
        session, event.business_id, event.location_id, payload["money_location"]
    )
    row.balance_minor -= int(payload["amount_minor"])
    row.last_event_id = event.id
    row.updated_at_ledger = event.occurred_at


@register_projection("SALE_RECORDED")
async def on_sale_recorded_money(session: AsyncSession, event: Event) -> None:
    if event.location_id is None:
        raise ValueError("SALE_RECORDED requires location_id on the envelope.")
    payload = event.payload
    for pay in payload["payments"]:
        if pay["method"] == "credit":
            continue
        row = await _get_or_create_locked(
            session, event.business_id, event.location_id, pay["method"]
        )
        row.balance_minor += int(pay["amount_minor"])
        row.last_event_id = event.id
        row.updated_at_ledger = event.occurred_at


@register_projection("DAY_OPENED")
async def on_day_opened(session: AsyncSession, event: Event) -> None:
    if event.location_id is None:
        raise ValueError("DAY_OPENED requires location_id on the envelope.")
    payload = event.payload
    row = await _get_or_create_locked(session, event.business_id, event.location_id, "till")
    row.balance_minor = int(payload["counted_amount_minor"])
    row.last_event_id = event.id
    row.updated_at_ledger = event.occurred_at


@register_projection("DAY_CLOSED")
async def on_day_closed(session: AsyncSession, event: Event) -> None:
    if event.location_id is None:
        raise ValueError("DAY_CLOSED requires location_id on the envelope.")
    payload = event.payload
    row = await _get_or_create_locked(session, event.business_id, event.location_id, "till")
    row.balance_minor = int(payload["counted_amount_minor"])
    row.last_event_id = event.id
    row.updated_at_ledger = event.occurred_at


def recompute_from_events(events: list[Event]) -> dict[tuple[str, str, str], int]:
    """Pure recomputation used by the nightly audit task (tasks/projection_audit.py)
    and by tests: replays MONEY_TRANSFERRED/EXPENSE_RECORDED events in
    order and returns {(business_id, location_id, account_key): balance_minor}.
    Deliberately has no DB access -- it's the independent "truth" the live
    projection is diffed against.
    """
    balances: dict[tuple[str, str, str], int] = {}

    def _bump(business_id: str, location_id: str, account_key: str, delta: int) -> None:
        key = (business_id, location_id, account_key)
        balances[key] = balances.get(key, 0) + delta

    for event in events:
        if event.location_id is None:
            continue
        if event.type == "MONEY_TRANSFERRED":
            amount = int(event.payload["amount_minor"])
            _bump(
                event.business_id, event.location_id, event.payload["from_money_location"], -amount
            )
            _bump(event.business_id, event.location_id, event.payload["to_money_location"], amount)
        elif event.type == "EXPENSE_RECORDED":
            amount = int(event.payload["amount_minor"])
            _bump(event.business_id, event.location_id, event.payload["money_location"], -amount)
        elif event.type == "SALE_RECORDED":
            for pay in event.payload["payments"]:
                if pay["method"] == "credit":
                    continue
                _bump(event.business_id, event.location_id, pay["method"], int(pay["amount_minor"]))
        elif event.type in ("DAY_OPENED", "DAY_CLOSED"):
            key = (event.business_id, event.location_id, "till")
            balances[key] = int(event.payload["counted_amount_minor"])

    return balances
