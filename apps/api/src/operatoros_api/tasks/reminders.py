"""The unattended reminder tick (spec D.6.5, plan §0.4): every 15 minutes
(`tasks/celery_app.py`'s beat schedule), computes who's due across every
business and sends -- UNLESS that business's default schedule is in
approval mode, in which case sending waits for an explicit
`POST /api/v1/debt/reminder-digest/send` (`api/routers/debt.py`) instead.
This task and that endpoint both call the same
`api/routers/debt.py::send_one_reminder` -- one send path, never two.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from sqlalchemy import select

from operatoros_api.db import tenant_scoped_session
from operatoros_api.debt_ageing import open_invoices_for_business
from operatoros_api.models.reminders import ReminderSchedule
from operatoros_api.models.tenancy import Business
from operatoros_api.reminders_engine import compute_due_reminders
from operatoros_api.tasks.celery_app import celery_app


async def _tick_for_business(business_id: str, now: datetime) -> int:
    from operatoros_api.api.routers.debt import send_one_reminder

    async with tenant_scoped_session(business_id) as session:
        default_result = await session.execute(
            select(ReminderSchedule).where(
                ReminderSchedule.business_id == business_id,
                ReminderSchedule.customer_id.is_(None),
            )
        )
        default_schedule = default_result.scalar_one_or_none()
        if default_schedule is None or default_schedule.approval_mode:
            # Nothing to auto-send: either no schedule configured at all,
            # or approval mode means a human must review the digest first
            # (api/routers/debt.py::get_reminder_digest computes the exact
            # same due list live, on demand).
            return 0

        invoices_by_customer = await open_invoices_for_business(session, business_id)
        due = await compute_due_reminders(session, business_id, invoices_by_customer, now)
        for d in due:
            await send_one_reminder(session, business_id, None, d)
        await session.flush()
        return len(due)


async def run_reminder_tick_async() -> int:
    now = datetime.now(UTC)
    async with tenant_scoped_session(None) as session:
        result = await session.execute(select(Business.id))
        business_ids = [row[0] for row in result.all()]

    total = 0
    for business_id in business_ids:
        total += await _tick_for_business(business_id, now)
    return total


@celery_app.task(name="operatoros_api.tasks.reminders.run_reminder_tick")
def run_reminder_tick() -> int:
    return asyncio.run(run_reminder_tick_async())
