"""The `customer_balance` projection (spec E.3, plan §0.2/§2).

Driven by `CUSTOMER_CREATED` (creates the balance row), `CREDIT_LIMIT_CHANGED`
(sets `credit_limit_minor`), `SALE_RECORDED` (a credit-method payment line
raises the balance), and `RETURN_RECORDED` (a credit-note refund lowers it).

**`oldest_unpaid_at` is a simplified Phase 1 approximation.** Spec E.3
defines it as part of the projection, but the real ageing calculation
(per-invoice due dates, D.6.3's "Invoices tab") is Debt Book, Phase 2 —
there is no `invoices` table yet. Here it is set to the event's
`occurred_at` the moment the balance first goes from <= 0 to > 0, and
cleared back to `None` the moment it returns to <= 0. This is honest about
being a placeholder: it answers "since when has this customer owed
*something*", not "which invoice is oldest" — good enough to sort a debtor
list by roughly how long they've been in debt, not good enough for
per-invoice terms/due-date ageing. Flagged in docs/DECISIONS.md.

**`RETURN_RECORDED`'s customer is resolved via the original `Sale` row**,
not the event payload — `ReturnRecordedPayload` has no `customer_id` field
(see events_registry.py; it wasn't in Phase 0's fixed registry and adding
one is out of scope this phase). Only a `refund_method == "credit_note"`
return affects the balance; cash/MoMo/bank refunds move money, not debt.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from operatoros_api.models.customers import CustomerBalance
from operatoros_api.models.events import Event
from operatoros_api.models.sales import Sale
from operatoros_api.projections.framework import register_projection


async def _get_or_create_locked(
    session: AsyncSession, business_id: str, customer_id: str
) -> CustomerBalance:
    result = await session.execute(
        select(CustomerBalance)
        .where(
            CustomerBalance.business_id == business_id,
            CustomerBalance.customer_id == customer_id,
        )
        .with_for_update()
    )
    row = result.scalar_one_or_none()
    if row is None:
        row = CustomerBalance(
            business_id=business_id,
            customer_id=customer_id,
            credit_limit_minor=0,
            balance_minor=0,
        )
        session.add(row)
        await session.flush()
    return row


def _apply_balance_delta(row: CustomerBalance, delta_minor: int, event: Event) -> None:
    was_positive = row.balance_minor > 0
    row.balance_minor += delta_minor
    is_positive = row.balance_minor > 0
    if not was_positive and is_positive:
        row.oldest_unpaid_at = event.occurred_at
    elif was_positive and not is_positive:
        row.oldest_unpaid_at = None
    row.last_event_id = event.id
    row.updated_at_ledger = event.occurred_at


@register_projection("CUSTOMER_CREATED")
async def on_customer_created(session: AsyncSession, event: Event) -> None:
    await _get_or_create_locked(session, event.business_id, event.payload["customer_id"])


@register_projection("CREDIT_LIMIT_CHANGED")
async def on_credit_limit_changed(session: AsyncSession, event: Event) -> None:
    payload = event.payload
    row = await _get_or_create_locked(session, event.business_id, payload["customer_id"])
    row.credit_limit_minor = int(payload["new_limit_minor"])
    row.last_event_id = event.id
    row.updated_at_ledger = event.occurred_at


@register_projection("SALE_RECORDED")
async def on_sale_recorded_balance(session: AsyncSession, event: Event) -> None:
    payload = event.payload
    customer_id = payload.get("customer_id")
    if not customer_id:
        return
    credit_amount = sum(
        int(p["amount_minor"]) for p in payload["payments"] if p["method"] == "credit"
    )
    if credit_amount == 0:
        return
    row = await _get_or_create_locked(session, event.business_id, customer_id)
    _apply_balance_delta(row, credit_amount, event)


@register_projection("RETURN_RECORDED")
async def on_return_recorded_balance(session: AsyncSession, event: Event) -> None:
    payload = event.payload
    if payload["refund_method"] != "credit_note":
        return
    sale = await session.get(Sale, payload["sale_id"])
    if sale is None or sale.customer_id is None:
        return
    row = await _get_or_create_locked(session, event.business_id, sale.customer_id)
    _apply_balance_delta(row, -int(payload["refund_amount_minor"]), event)


def recompute_from_events(
    events: list[Event], sale_customer_ids: dict[str, str | None]
) -> dict[tuple[str, str], int]:
    """Pure recomputation used by the nightly audit task and by tests:
    replays `SALE_RECORDED`/`RETURN_RECORDED` in order and returns
    `{(business_id, customer_id): balance_minor}`.

    `sale_customer_ids` (`{sale_id: customer_id}`) is the one piece of
    external state this needs that isn't in the events themselves —
    `RETURN_RECORDED` has no `customer_id` field (see module docstring), so
    a `credit_note` return's customer can only be resolved via its original
    sale. The audit task (tasks/projection_audit.py) builds this map with a
    single light query over `sales`; tests build it directly. This keeps
    the actual balance arithmetic here pure and independent of DB access,
    even though the full audit isn't quite DB-access-free end to end.
    """
    balances: dict[tuple[str, str], int] = {}

    def _bump(business_id: str, customer_id: str, delta: int) -> None:
        key = (business_id, customer_id)
        balances[key] = balances.get(key, 0) + delta

    for event in events:
        payload = event.payload
        if event.type == "SALE_RECORDED":
            customer_id = payload.get("customer_id")
            if not customer_id:
                continue
            credit_amount = sum(
                int(p["amount_minor"]) for p in payload["payments"] if p["method"] == "credit"
            )
            if credit_amount:
                _bump(event.business_id, customer_id, credit_amount)
        elif event.type == "RETURN_RECORDED":
            if payload["refund_method"] != "credit_note":
                continue
            customer_id = sale_customer_ids.get(payload["sale_id"])
            if not customer_id:
                continue
            _bump(event.business_id, customer_id, -int(payload["refund_amount_minor"]))

    return balances
