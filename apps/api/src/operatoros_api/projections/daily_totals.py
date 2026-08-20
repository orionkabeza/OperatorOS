"""The `daily_totals`/`staff_daily_totals`/`product_daily_movement`
projections (plan §2), backing the Overview's "Today" and "Top and bottom"
sections (spec D.10.1).

All three key on `business_date` — resolved by looking up the currently
OPEN `DaySession` for the event's `(business_id, location_id)`, not the UTC
calendar date of `event.occurred_at`. This is deliberate (docs/DECISIONS.md):
a shop's trading day is whatever `DAY_OPENED`/`DAY_CLOSED` says it is (spec
D.3/D.11's own ritual), and it's what naturally keeps working when a day is
reopened for a late transaction (spec D.11: "Late transactions ... require
the day to be reopened") — the reopened session's `status` flips back to
`open`, so this same lookup finds it without any extra plumbing. If no open
day session exists for the location, that's an invariant violation (the
`sales`/`day` routers are supposed to block writes when the day isn't
open) and this raises rather than silently guessing a date.

Staff attribution uses `event.actor_user_id` (the envelope's own field,
set from the authenticated caller) — `SaleRecordedPayload` has no separate
staff/cashier field, and doesn't need one.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from operatoros_api.models.day_till import DaySession
from operatoros_api.models.events import Event
from operatoros_api.models.projections import DailyTotals, ProductDailyMovement, StaffDailyTotals
from operatoros_api.projections.framework import register_projection


async def _business_date(session: AsyncSession, business_id: str, location_id: str) -> date:
    # Ordered + limited to the most-recently-opened session rather than
    # scalar_one_or_none(): the `day` router's own open-day endpoint blocks
    # a second concurrent open for the same location, so in real operation
    # there is only ever one open DaySession per location -- but this
    # handler shouldn't itself assume that invariant is unbreakable (e.g. a
    # test fixture or a future admin tool inserting a row directly), so it
    # picks the most recent rather than raising MultipleResultsFound.
    result = await session.execute(
        select(DaySession.business_date)
        .where(
            DaySession.business_id == business_id,
            DaySession.location_id == location_id,
            DaySession.status == "open",
        )
        .order_by(DaySession.opened_at.desc())
        .limit(1)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise ValueError(
            f"No open day session for business={business_id} location={location_id}; "
            "cannot attribute daily totals."
        )
    return row


async def _get_or_create_daily_totals_locked(
    session: AsyncSession, business_id: str, location_id: str, business_date: date
) -> DailyTotals:
    result = await session.execute(
        select(DailyTotals)
        .where(
            DailyTotals.business_id == business_id,
            DailyTotals.location_id == location_id,
            DailyTotals.business_date == business_date,
        )
        .with_for_update()
    )
    row = result.scalar_one_or_none()
    if row is None:
        row = DailyTotals(
            business_id=business_id,
            location_id=location_id,
            business_date=business_date,
            by_payment_method={},
        )
        session.add(row)
        await session.flush()
    return row


async def _get_or_create_staff_daily_totals_locked(
    session: AsyncSession,
    business_id: str,
    location_id: str,
    business_date: date,
    staff_user_id: str,
) -> StaffDailyTotals:
    result = await session.execute(
        select(StaffDailyTotals)
        .where(
            StaffDailyTotals.business_id == business_id,
            StaffDailyTotals.location_id == location_id,
            StaffDailyTotals.business_date == business_date,
            StaffDailyTotals.staff_user_id == staff_user_id,
        )
        .with_for_update()
    )
    row = result.scalar_one_or_none()
    if row is None:
        row = StaffDailyTotals(
            business_id=business_id,
            location_id=location_id,
            business_date=business_date,
            staff_user_id=staff_user_id,
        )
        session.add(row)
        await session.flush()
    return row


async def _get_or_create_product_daily_movement_locked(
    session: AsyncSession, business_id: str, location_id: str, business_date: date, product_id: str
) -> ProductDailyMovement:
    result = await session.execute(
        select(ProductDailyMovement)
        .where(
            ProductDailyMovement.business_id == business_id,
            ProductDailyMovement.location_id == location_id,
            ProductDailyMovement.business_date == business_date,
            ProductDailyMovement.product_id == product_id,
        )
        .with_for_update()
    )
    row = result.scalar_one_or_none()
    if row is None:
        row = ProductDailyMovement(
            business_id=business_id,
            location_id=location_id,
            business_date=business_date,
            product_id=product_id,
            quantity_sold=Decimal("0"),
            quantity_returned=Decimal("0"),
        )
        session.add(row)
        await session.flush()
    return row


@register_projection("SALE_RECORDED")
async def on_sale_recorded_daily_totals(session: AsyncSession, event: Event) -> None:
    if event.location_id is None:
        raise ValueError("SALE_RECORDED requires location_id on the envelope.")
    payload = event.payload
    business_date = await _business_date(session, event.business_id, event.location_id)

    totals = await _get_or_create_daily_totals_locked(
        session, event.business_id, event.location_id, business_date
    )
    totals.revenue_minor += int(payload["total_minor"])
    totals.discount_minor += int(payload["discount_minor"])
    totals.tax_minor += int(payload["tax_minor"])
    by_method = dict(totals.by_payment_method or {})
    credit_amount = 0
    for pay in payload["payments"]:
        amount = int(pay["amount_minor"])
        by_method[pay["method"]] = by_method.get(pay["method"], 0) + amount
        if pay["method"] == "credit":
            credit_amount += amount
    totals.by_payment_method = by_method
    totals.credit_minor += credit_amount
    totals.transaction_count += 1
    totals.last_event_id = event.id
    totals.updated_at_ledger = event.occurred_at

    if event.actor_user_id:
        staff_totals = await _get_or_create_staff_daily_totals_locked(
            session, event.business_id, event.location_id, business_date, event.actor_user_id
        )
        staff_totals.sales_amount_minor += int(payload["total_minor"])
        staff_totals.discount_given_minor += int(payload["discount_minor"])
        staff_totals.transaction_count += 1
        staff_totals.last_event_id = event.id
        staff_totals.updated_at_ledger = event.occurred_at

    for line in payload["lines"]:
        movement = await _get_or_create_product_daily_movement_locked(
            session, event.business_id, event.location_id, business_date, line["product_id"]
        )
        movement.quantity_sold += Decimal(line["quantity"])
        movement.revenue_minor += int(line["line_total_minor"])
        movement.last_event_id = event.id
        movement.updated_at_ledger = event.occurred_at


@register_projection("RETURN_RECORDED")
async def on_return_recorded_daily_totals(session: AsyncSession, event: Event) -> None:
    if event.location_id is None:
        raise ValueError("RETURN_RECORDED requires location_id on the envelope.")
    payload = event.payload
    business_date = await _business_date(session, event.business_id, event.location_id)

    totals = await _get_or_create_daily_totals_locked(
        session, event.business_id, event.location_id, business_date
    )
    totals.returns_amount_minor += int(payload["refund_amount_minor"])
    totals.returns_count += 1
    totals.last_event_id = event.id
    totals.updated_at_ledger = event.occurred_at

    if event.actor_user_id:
        staff_totals = await _get_or_create_staff_daily_totals_locked(
            session, event.business_id, event.location_id, business_date, event.actor_user_id
        )
        staff_totals.returns_amount_minor += int(payload["refund_amount_minor"])
        staff_totals.last_event_id = event.id
        staff_totals.updated_at_ledger = event.occurred_at

    for line in payload["lines"]:
        movement = await _get_or_create_product_daily_movement_locked(
            session, event.business_id, event.location_id, business_date, line["product_id"]
        )
        movement.quantity_returned += Decimal(line["quantity"])
        movement.last_event_id = event.id
        movement.updated_at_ledger = event.occurred_at
