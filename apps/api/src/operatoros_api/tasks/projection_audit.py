"""The nightly projection-audit job (spec E.3).

Recomputes `money_location_balance` from the event log alone (via the pure
`recompute_from_events` function -- no DB access, no dependency on the
live projection's own bookkeeping) and diffs it against the live
projection, per business. Any mismatch is logged at ERROR with the exact
business/location/account and expected-vs-actual figures, and the task
raises so Celery marks it FAILED (surfacing in whatever monitors task
failures) rather than silently succeeding with drift outstanding.

See tests/test_projection_audit_task.py, which injects a discrepancy
(a raw update through the same trigger-bypassing test path used in
test_projection_trigger.py) and asserts this task both detects it and
raises.
"""

from __future__ import annotations

import asyncio

import structlog
from sqlalchemy import select

from operatoros_api.db import tenant_scoped_session
from operatoros_api.models.events import Event
from operatoros_api.models.projections import MoneyLocationBalance
from operatoros_api.models.tenancy import Business
from operatoros_api.projections.money_location_balance import recompute_from_events
from operatoros_api.tasks.celery_app import celery_app

logger = structlog.get_logger("operatoros_api.projection_audit")


class ProjectionDrift(Exception):
    def __init__(self, drifts: list[dict]) -> None:
        super().__init__(f"{len(drifts)} money_location_balance row(s) drifted from the event log")
        self.drifts = drifts


async def audit_business(business_id: str) -> list[dict]:
    async with tenant_scoped_session(business_id) as session:
        event_result = await session.execute(
            select(Event)
            .where(
                Event.business_id == business_id,
                Event.type.in_(["MONEY_TRANSFERRED", "EXPENSE_RECORDED"]),
            )
            .order_by(Event.occurred_at)
        )
        events = list(event_result.scalars())
        recomputed = recompute_from_events(events)

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
                    "business_id": key[0],
                    "location_id": key[1],
                    "account_key": key[2],
                    "expected_minor": expected,
                    "actual_minor": actual,
                }
            )
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
