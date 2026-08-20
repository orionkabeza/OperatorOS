"""The `customer_balance` projection (spec E.3, plan §0.2/§2).

Driven by `CUSTOMER_CREATED` (creates the balance row), `CREDIT_LIMIT_CHANGED`
(sets `credit_limit_minor`), `SALE_RECORDED` (a credit-method payment line
raises the balance), `RETURN_RECORDED` (a credit-note refund lowers it),
and, as of plan §2, `PAYMENT_RECEIVED` (lowers the balance -- the debt-book
half of the same event `money_location_balance.py`'s own `PAYMENT_RECEIVED`
handler moves money for, in the same transaction, same pattern
`SALE_RECORDED` already uses across both projections) and
`DEBT_WRITTEN_OFF` (balance -> 0, `written_off`/`written_off_at` set).

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
        # A customer who owes money again after a write-off has, by
        # definition, walked back in and bought on credit again (spec
        # D.6.6: "they walk back in eventually") -- this new debt is not
        # the debt that got written off, so the "Written off" status chip
        # (D.6.2) should reflect their CURRENT standing, not a historical
        # event. The write-off itself remains a permanent fact in the event
        # log regardless.
        row.written_off = False
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


@register_projection("PAYMENT_RECEIVED")
async def on_payment_received_balance(session: AsyncSession, event: Event) -> None:
    """Plan §0.1/§2: the debt-book half of `PAYMENT_RECEIVED` -- lowers the
    customer's balance. The money-location half
    (projections/money_location_balance.py::on_payment_received_money)
    raises the till/momo/bank balance for the SAME event, in the SAME
    transaction (projections/framework.py::apply_projections runs every
    handler registered for one event type inside one `SET LOCAL
    app.projection_writer` window, itself inside the caller's own
    transaction) -- either both happen or neither does. See
    tests/test_debt_payment_atomicity.py for the proof, mirroring
    tests/test_projection_transactional.py's pattern for SALE_RECORDED.

    Supplier payments (`payload.supplier_id` set, `customer_id` absent)
    don't touch `customer_balance` at all -- `PAYMENT_MADE`, not
    `PAYMENT_RECEIVED`, is the supplier-payment event type, and stays
    unwired this phase (plan §0.1, D.8.4/Phase 3). A `PAYMENT_RECEIVED`
    with no `customer_id` (e.g. "other income", D.7.3) is a pure
    money-location-only event -- nothing to do here.
    """
    payload = event.payload
    customer_id = payload.get("customer_id")
    if not customer_id:
        return
    row = await _get_or_create_locked(session, event.business_id, customer_id)
    _apply_balance_delta(row, -int(payload["amount_minor"]), event)


@register_projection("DEBT_WRITTEN_OFF")
async def on_debt_written_off(session: AsyncSession, event: Event) -> None:
    """Spec D.6.6: writes off the customer's CURRENT balance to zero and
    marks the customer `written_off` -- a loss, not a payment; no money
    moves in `money_location_balance` (there is no corresponding handler
    there, deliberately -- see that module). `payload.amount_minor` is the
    amount being written off as recorded by the caller
    (`api/routers/debt.py`); the balance is set to exactly zero rather than
    decremented by that amount so a write-off can never leave a stray
    residual balance if the two figures ever drifted (e.g. a payment
    landing between the drawer opening and the write-off being confirmed).
    """
    payload = event.payload
    row = await _get_or_create_locked(session, event.business_id, payload["customer_id"])
    row.balance_minor = 0
    row.oldest_unpaid_at = None
    row.written_off = True
    row.written_off_at = event.occurred_at
    row.last_event_id = event.id
    row.updated_at_ledger = event.occurred_at


def recompute_from_events(
    events: list[Event], sale_customer_ids: dict[str, str | None]
) -> dict[tuple[str, str], int]:
    """Pure recomputation used by the nightly audit task and by tests:
    replays `SALE_RECORDED`/`RETURN_RECORDED`/`PAYMENT_RECEIVED`/
    `DEBT_WRITTEN_OFF` in order and returns
    `{(business_id, customer_id): balance_minor}`.

    `sale_customer_ids` (`{sale_id: customer_id}`) is the one piece of
    external state this needs that isn't in the events themselves —
    `RETURN_RECORDED` has no `customer_id` field (see module docstring), so
    a `credit_note` return's customer can only be resolved via its original
    sale. The audit task (tasks/projection_audit.py) builds this map with a
    single light query over `sales`; tests build it directly. This keeps
    the actual balance arithmetic here pure and independent of DB access,
    even though the full audit isn't quite DB-access-free end to end.

    `DEBT_WRITTEN_OFF` sets the balance to exactly zero rather than
    decrementing it (mirroring `on_debt_written_off` above) — a plain
    running-delta replay would otherwise diverge from the live projection
    the instant a write-off's recorded `amount_minor` differs even slightly
    from the balance at the moment it was applied.
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
        elif event.type == "PAYMENT_RECEIVED":
            customer_id = payload.get("customer_id")
            if not customer_id:
                continue
            _bump(event.business_id, customer_id, -int(payload["amount_minor"]))
        elif event.type == "DEBT_WRITTEN_OFF":
            balances[(event.business_id, payload["customer_id"])] = 0

    return balances
