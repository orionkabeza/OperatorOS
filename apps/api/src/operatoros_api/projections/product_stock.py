"""The `product_stock` projection (spec E.3, plan §2).

Updates `ProductLocation.on_hand`/`avg_cost_minor` AND appends one
`StockMovement` ledger row (D.5.3: "one row per unit-affecting event,
append-only, feeds the stock card") in the same call — both tables are
written exclusively from here, both protected by
`reject_direct_projection_write()`. Every quantity is `Decimal`, parsed
from the payload's decimal-string transport (events_registry.py's
`SaleLineInput`/`StockReceivedPayload`/... convention) — never a float.

**STOCKTAKE_POSTED is deliberately NOT registered here.** Its payload
(`StocktakePostedPayload`: `stocktake_id, location_id, variance_value_minor,
line_count`) is a rolled-up summary with no per-product quantities — it
cannot drive a per-product stock change on its own. The actual corrections
are individual `STOCK_ADJUSTED` events, one per line with a non-zero
variance, appended by `api/routers/stock.py`'s stocktake-post endpoint
*alongside* one summary `STOCKTAKE_POSTED` event, all in the same
transaction; `on_stock_adjusted` below is what actually moves `on_hand` for
each corrected line. Plan §2 lists STOCKTAKE_POSTED as one of the events
"driving" `product_stock`, which is true of the stocktake-post *action* as
a whole (it does move stock) but not of that one summary event payload in
isolation — see docs/DECISIONS.md for the full reasoning, flagged there
since events_registry.py is fixed this phase and can't grow a per-line
field to resolve it more directly.

**RETURN_RECORDED's `lines` carries only the restocked subset.** Spec D.4:
a return line is either restocked or written off as damaged ("damaged goods
write a STOCK_WRITTEN_OFF event, not a stock-in"), but
`ReturnRecordedPayload.lines` (reusing `SaleLineInput`) has no per-line
restock flag to distinguish them within one event. `api/routers/sales.py`'s
return endpoint resolves this by putting only the lines the caller marked
"restock" into the `RETURN_RECORDED` payload, and appending one
`STOCK_WRITTEN_OFF` event per damaged line alongside it — see
docs/DECISIONS.md. `on_return_recorded` below therefore restocks
everything in the payload unconditionally; that's correct because the
router has already filtered it.
"""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from operatoros_api.models.catalog import ProductLocation
from operatoros_api.models.events import Event
from operatoros_api.models.stock import StockMovement
from operatoros_api.projections.framework import register_projection


async def _get_or_create_locked(
    session: AsyncSession, business_id: str, location_id: str, product_id: str
) -> ProductLocation:
    result = await session.execute(
        select(ProductLocation)
        .where(
            ProductLocation.business_id == business_id,
            ProductLocation.location_id == location_id,
            ProductLocation.product_id == product_id,
        )
        .with_for_update()
    )
    row = result.scalar_one_or_none()
    if row is None:
        row = ProductLocation(
            business_id=business_id,
            location_id=location_id,
            product_id=product_id,
            on_hand=Decimal("0"),
            reserved=Decimal("0"),
            avg_cost_minor=0,
        )
        session.add(row)
        await session.flush()
    return row


async def _apply_movement(
    session: AsyncSession,
    event: Event,
    *,
    location_id: str,
    product_id: str,
    quantity_delta: Decimal,
    movement_type: str,
    reference_type: str,
    reference_id: str | None,
    unit_cost_minor: int | None = None,
    new_avg_cost_minor: int | None = None,
) -> ProductLocation:
    row = await _get_or_create_locked(session, event.business_id, location_id, product_id)
    row.on_hand = row.on_hand + quantity_delta
    if new_avg_cost_minor is not None:
        row.avg_cost_minor = new_avg_cost_minor
    row.last_event_id = event.id
    row.updated_at_ledger = event.occurred_at

    session.add(
        StockMovement(
            business_id=event.business_id,
            location_id=location_id,
            product_id=product_id,
            movement_type=movement_type,
            quantity_delta=quantity_delta,
            running_balance=row.on_hand,
            unit_cost_minor=unit_cost_minor,
            reference_type=reference_type,
            reference_id=reference_id,
            source_event_id=event.id,
            actor_user_id=event.actor_user_id,
            occurred_at=event.occurred_at,
        )
    )
    return row


def _weighted_avg_cost(
    old_on_hand: Decimal, old_avg_cost_minor: int, qty_in: Decimal, unit_cost_minor: int
) -> int:
    new_total_qty = old_on_hand + qty_in
    if new_total_qty <= 0:
        return unit_cost_minor
    weighted = (old_on_hand * old_avg_cost_minor) + (qty_in * unit_cost_minor)
    return int((weighted / new_total_qty).to_integral_value(rounding="ROUND_HALF_UP"))


@register_projection("STOCK_RECEIVED")
async def on_stock_received(session: AsyncSession, event: Event) -> None:
    payload = event.payload
    qty = Decimal(payload["quantity"])
    unit_cost_minor = int(payload["unit_cost_minor"])
    location_id = payload["location_id"]
    product_id = payload["product_id"]

    existing = await _get_or_create_locked(session, event.business_id, location_id, product_id)
    new_avg = _weighted_avg_cost(existing.on_hand, existing.avg_cost_minor, qty, unit_cost_minor)

    await _apply_movement(
        session,
        event,
        location_id=location_id,
        product_id=product_id,
        quantity_delta=qty,
        movement_type="purchase_receipt",
        reference_type="stock_receive",
        reference_id=payload.get("reference"),
        unit_cost_minor=unit_cost_minor,
        new_avg_cost_minor=new_avg,
    )


@register_projection("STOCK_ISSUED")
async def on_stock_issued(session: AsyncSession, event: Event) -> None:
    payload = event.payload
    qty = Decimal(payload["quantity"])
    await _apply_movement(
        session,
        event,
        location_id=payload["location_id"],
        product_id=payload["product_id"],
        quantity_delta=-qty,
        movement_type="issue",
        reference_type="stock_issue",
        reference_id=payload.get("reference"),
    )


@register_projection("STOCK_ADJUSTED")
async def on_stock_adjusted(session: AsyncSession, event: Event) -> None:
    payload = event.payload
    delta = Decimal(payload["quantity_delta"])
    await _apply_movement(
        session,
        event,
        location_id=payload["location_id"],
        product_id=payload["product_id"],
        quantity_delta=delta,
        movement_type="adjustment",
        reference_type="adjustment",
        reference_id=None,
    )


@register_projection("STOCK_TRANSFERRED_OUT")
async def on_stock_transferred_out(session: AsyncSession, event: Event) -> None:
    payload = event.payload
    qty = Decimal(payload["quantity"])
    await _apply_movement(
        session,
        event,
        location_id=payload["from_location_id"],
        product_id=payload["product_id"],
        quantity_delta=-qty,
        movement_type="transfer_out",
        reference_type="transfer",
        reference_id=payload["transfer_id"],
    )


@register_projection("STOCK_TRANSFERRED_IN")
async def on_stock_transferred_in(session: AsyncSession, event: Event) -> None:
    payload = event.payload
    qty = Decimal(payload["quantity"])
    await _apply_movement(
        session,
        event,
        location_id=payload["to_location_id"],
        product_id=payload["product_id"],
        quantity_delta=qty,
        movement_type="transfer_in",
        reference_type="transfer",
        reference_id=payload["transfer_id"],
    )


@register_projection("STOCK_WRITTEN_OFF")
async def on_stock_written_off(session: AsyncSession, event: Event) -> None:
    payload = event.payload
    qty = Decimal(payload["quantity"])
    await _apply_movement(
        session,
        event,
        location_id=payload["location_id"],
        product_id=payload["product_id"],
        quantity_delta=-qty,
        movement_type="write_off",
        reference_type="write_off",
        reference_id=None,
    )


@register_projection("SALE_RECORDED")
async def on_sale_recorded_stock(session: AsyncSession, event: Event) -> None:
    if event.location_id is None:
        raise ValueError("SALE_RECORDED requires location_id on the envelope.")
    payload = event.payload
    for line in payload["lines"]:
        qty = Decimal(line["quantity"])
        await _apply_movement(
            session,
            event,
            location_id=event.location_id,
            product_id=line["product_id"],
            quantity_delta=-qty,
            movement_type="sale",
            reference_type="sale",
            reference_id=payload["sale_id"],
        )


@register_projection("RETURN_RECORDED")
async def on_return_recorded_stock(session: AsyncSession, event: Event) -> None:
    """Restocks every line present in the payload — see module docstring
    for why that's always correct here (the router pre-filters to the
    restocked subset)."""
    if event.location_id is None:
        raise ValueError("RETURN_RECORDED requires location_id on the envelope.")
    payload = event.payload
    for line in payload["lines"]:
        qty = Decimal(line["quantity"])
        await _apply_movement(
            session,
            event,
            location_id=event.location_id,
            product_id=line["product_id"],
            quantity_delta=qty,
            movement_type="return",
            reference_type="return",
            reference_id=payload["return_id"],
        )


def recompute_from_events(events: list[Event]) -> dict[tuple[str, str, str], Decimal]:
    """Pure recomputation used by the nightly audit task
    (tasks/projection_audit.py) and by tests: replays every stock-affecting
    event type in order and returns
    `{(business_id, location_id, product_id): on_hand}`. No DB access —
    mirrors the handlers above exactly, but as the independent "truth" the
    live `product_locations.on_hand` is diffed against.
    """
    on_hand: dict[tuple[str, str, str], Decimal] = {}

    def _bump(business_id: str, location_id: str, product_id: str, delta: Decimal) -> None:
        key = (business_id, location_id, product_id)
        on_hand[key] = on_hand.get(key, Decimal("0")) + delta

    for event in events:
        payload = event.payload
        if event.type == "STOCK_RECEIVED":
            _bump(
                event.business_id,
                payload["location_id"],
                payload["product_id"],
                Decimal(payload["quantity"]),
            )
        elif event.type == "STOCK_ISSUED":
            _bump(
                event.business_id,
                payload["location_id"],
                payload["product_id"],
                -Decimal(payload["quantity"]),
            )
        elif event.type == "STOCK_ADJUSTED":
            _bump(
                event.business_id,
                payload["location_id"],
                payload["product_id"],
                Decimal(payload["quantity_delta"]),
            )
        elif event.type == "STOCK_TRANSFERRED_OUT":
            _bump(
                event.business_id,
                payload["from_location_id"],
                payload["product_id"],
                -Decimal(payload["quantity"]),
            )
        elif event.type == "STOCK_TRANSFERRED_IN":
            _bump(
                event.business_id,
                payload["to_location_id"],
                payload["product_id"],
                Decimal(payload["quantity"]),
            )
        elif event.type == "STOCK_WRITTEN_OFF":
            _bump(
                event.business_id,
                payload["location_id"],
                payload["product_id"],
                -Decimal(payload["quantity"]),
            )
        elif event.type == "SALE_RECORDED" and event.location_id is not None:
            for line in payload["lines"]:
                _bump(
                    event.business_id,
                    event.location_id,
                    line["product_id"],
                    -Decimal(line["quantity"]),
                )
        elif event.type == "RETURN_RECORDED" and event.location_id is not None:
            for line in payload["lines"]:
                _bump(
                    event.business_id,
                    event.location_id,
                    line["product_id"],
                    Decimal(line["quantity"]),
                )

    return on_hand
