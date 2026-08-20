"""The nightly projection-audit job (spec E.3).

Phase 0 recomputed `money_location_balance` alone. Plan §2 explicitly
extends this "to recompute and diff all of the above, not just
money_location_balance" — this now also covers `product_locations.on_hand`
(the `product_stock` projection) and `customer_balances.balance_minor`
(the `customer_balance` projection), each via that projection module's own
pure `recompute_from_events` function, no DB access beyond fetching the
relevant events (and, for `customer_balance` only, one light `sales` query
— see projections/customer_balance.py's docstring for why that one can't
be fully event-only). `daily_totals`/`staff_daily_totals`/
`product_daily_movement` are NOT covered here — see docs/DECISIONS.md: they
are reporting aggregates (Overview "Today"/"Top and bottom"), not money or
inventory integrity, and a faithful pure recompute would need to replicate
the `business_date`-via-open-day-session lookup outside the DB, which is a
meaningfully larger and lower-value undertaking than the other three.
Flagged as a disclosed gap, not silently skipped.

Any mismatch is logged at ERROR with the exact business/location/key and
expected-vs-actual figures, and the task raises so Celery marks it FAILED
(surfacing in whatever monitors task failures) rather than silently
succeeding with drift outstanding.

See tests/test_projection_audit_task.py, which injects a discrepancy
(a raw update through the same trigger-bypassing test path used in
test_projection_trigger.py) and asserts this task both detects it and
raises.
"""

from __future__ import annotations

import asyncio

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from operatoros_api.db import tenant_scoped_session
from operatoros_api.models.catalog import ProductLocation
from operatoros_api.models.customers import CustomerBalance
from operatoros_api.models.events import Event
from operatoros_api.models.projections import MoneyLocationBalance
from operatoros_api.models.sales import Sale
from operatoros_api.models.tenancy import Business
from operatoros_api.projections.customer_balance import (
    recompute_from_events as recompute_customer_balance,
)
from operatoros_api.projections.money_location_balance import (
    recompute_from_events as recompute_money_location_balance,
)
from operatoros_api.projections.product_stock import (
    recompute_from_events as recompute_product_stock,
)
from operatoros_api.tasks.celery_app import celery_app

logger = structlog.get_logger("operatoros_api.projection_audit")


class ProjectionDrift(Exception):
    def __init__(self, drifts: list[dict]) -> None:
        super().__init__(f"{len(drifts)} projection row(s) drifted from the event log")
        self.drifts = drifts


async def _audit_money_location_balance(session: AsyncSession, business_id: str) -> list[dict]:
    event_result = await session.execute(
        select(Event)
        .where(
            Event.business_id == business_id,
            Event.type.in_(
                [
                    "MONEY_TRANSFERRED",
                    "EXPENSE_RECORDED",
                    "SALE_RECORDED",
                    "DAY_OPENED",
                    "DAY_CLOSED",
                    "PAYMENT_RECEIVED",
                ]
            ),
        )
        .order_by(Event.occurred_at)
    )
    events = list(event_result.scalars())
    recomputed = recompute_money_location_balance(events)

    live_result = await session.execute(
        select(MoneyLocationBalance).where(MoneyLocationBalance.business_id == business_id)
    )
    live_rows = {
        (r.business_id, r.location_id, r.account_key): r.balance_minor
        for r in live_result.scalars()
    }

    drifts: list[dict] = []
    for key in set(recomputed) | set(live_rows):
        expected = recomputed.get(key, 0)
        actual = live_rows.get(key, 0)
        if expected != actual:
            drifts.append(
                {
                    "projection": "money_location_balance",
                    "business_id": key[0],
                    "location_id": key[1],
                    "account_key": key[2],
                    "expected_minor": expected,
                    "actual_minor": actual,
                }
            )
    return drifts


async def _audit_product_stock(session: AsyncSession, business_id: str) -> list[dict]:
    event_result = await session.execute(
        select(Event)
        .where(
            Event.business_id == business_id,
            Event.type.in_(
                [
                    "STOCK_RECEIVED",
                    "STOCK_ISSUED",
                    "STOCK_ADJUSTED",
                    "STOCK_TRANSFERRED_OUT",
                    "STOCK_TRANSFERRED_IN",
                    "STOCK_WRITTEN_OFF",
                    "SALE_RECORDED",
                    "RETURN_RECORDED",
                ]
            ),
        )
        .order_by(Event.occurred_at)
    )
    events = list(event_result.scalars())
    recomputed = recompute_product_stock(events)

    live_result = await session.execute(
        select(ProductLocation).where(ProductLocation.business_id == business_id)
    )
    live_rows = {
        (r.business_id, r.location_id, r.product_id): r.on_hand for r in live_result.scalars()
    }

    drifts: list[dict] = []
    for key in set(recomputed) | set(live_rows):
        expected = recomputed.get(key)
        actual = live_rows.get(key)
        if expected != actual:
            drifts.append(
                {
                    "projection": "product_stock",
                    "business_id": key[0],
                    "location_id": key[1],
                    "product_id": key[2],
                    "expected_on_hand": str(expected),
                    "actual_on_hand": str(actual),
                }
            )
    return drifts


async def _audit_customer_balance(session: AsyncSession, business_id: str) -> list[dict]:
    event_result = await session.execute(
        select(Event)
        .where(
            Event.business_id == business_id,
            Event.type.in_(
                ["SALE_RECORDED", "RETURN_RECORDED", "PAYMENT_RECEIVED", "DEBT_WRITTEN_OFF"]
            ),
        )
        .order_by(Event.occurred_at)
    )
    events = list(event_result.scalars())

    sale_result = await session.execute(
        select(Sale.id, Sale.customer_id).where(Sale.business_id == business_id)
    )
    sale_customer_ids = {row.id: row.customer_id for row in sale_result.all()}

    recomputed = recompute_customer_balance(events, sale_customer_ids)

    live_result = await session.execute(
        select(CustomerBalance).where(CustomerBalance.business_id == business_id)
    )
    live_rows = {(r.business_id, r.customer_id): r.balance_minor for r in live_result.scalars()}

    drifts: list[dict] = []
    for key in set(recomputed) | set(live_rows):
        expected = recomputed.get(key, 0)
        actual = live_rows.get(key, 0)
        if expected != actual:
            drifts.append(
                {
                    "projection": "customer_balance",
                    "business_id": key[0],
                    "customer_id": key[1],
                    "expected_minor": expected,
                    "actual_minor": actual,
                }
            )
    return drifts


async def audit_business(business_id: str) -> list[dict]:
    async with tenant_scoped_session(business_id) as session:
        drifts: list[dict] = []
        drifts.extend(await _audit_money_location_balance(session, business_id))
        drifts.extend(await _audit_product_stock(session, business_id))
        drifts.extend(await _audit_customer_balance(session, business_id))
    return drifts


async def run_audit_async() -> list[dict]:
    async with tenant_scoped_session(None) as session:
        # `businesses` has no RLS -- see tenancy_resolution.py -- so this
        # is the one legitimate place a query enumerates every tenant.
        result = await session.execute(select(Business.id))
        business_ids = [row[0] for row in result.all()]

    all_drifts: list[dict] = []
    for business_id in business_ids:
        drifts = await audit_business(business_id)
        if drifts:
            logger.error("projection_drift_detected", business_id=business_id, drifts=drifts)
        all_drifts.extend(drifts)
    return all_drifts


@celery_app.task(name="operatoros_api.tasks.projection_audit.run_projection_audit")
def run_projection_audit() -> int:
    drifts = asyncio.run(run_audit_async())
    if drifts:
        raise ProjectionDrift(drifts)
    return 0
