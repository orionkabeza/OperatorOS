"""The `reminder_log` projection half (spec E.3 lists `reminder_sends`
under E.4's entity-table list, plan §2 registers it here as the
`REMINDER_SENT`-driven half of `models/reminders.py::ReminderLog`).

Only `REMINDER_SENT` is handled here — the other write path into the same
table, `api/routers/debt.py`'s manual "Log a call" endpoint, writes
directly (see models/reminders.py's module docstring for why that's
correct for this one table).
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from operatoros_api.models.events import Event
from operatoros_api.models.reminders import ReminderLog
from operatoros_api.projections.framework import register_projection


@register_projection("REMINDER_SENT")
async def on_reminder_sent(session: AsyncSession, event: Event) -> None:
    payload = event.payload
    session.add(
        ReminderLog(
            business_id=event.business_id,
            customer_id=payload["customer_id"],
            source="auto",
            channel=payload["channel"],
            template_key=payload["template_key"],
            amount_minor=int(payload["amount_minor"]),
            sent_at=event.occurred_at,
            logged_by_user_id=event.actor_user_id,
            source_event_id=event.id,
        )
    )
