"""The reminder engine's real logic (spec D.6.5, plan §0.4): resolving
which schedule applies to a customer, computing which step is due right
now, quiet-hours/frequency guardrails, and merge-field template
rendering. Delivery itself goes through the existing `NotificationSender`
(`notifications.py`) -- this module only decides WHAT to send and WHETHER
sending is currently allowed; `api/routers/debt.py`'s reminder endpoints
and `tasks/reminders.py`'s Celery tick are the two callers.

**Which step is "due"?** For a customer's oldest open invoice, this walks
the schedule's steps from the largest `offset_days` down and picks the
first one whose offset has been reached (`actual_days_since_due >=
step.offset_days`) -- i.e. the step matching the customer's CURRENT
standing, not a sequential replay of every earlier step they may have
missed while the engine wasn't running. A step already sent for the SAME
invoice is never re-selected (`_already_sent_for_this_invoice`); the
48-hour "one message per customer across all sequences" guardrail
(D.6.5) is checked independently on top.

**Timezone simplification, disclosed:** "business-local" quiet hours
(D.6.5: "8pm-7am") are evaluated against `now`'s hour in UTC -- there is
no per-business timezone setting yet in this phase's scope (Back Office
D.10.6 would be where that lives). Flagged in docs/DECISIONS.md; correct
once a business timezone field exists, not before.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select

from operatoros_api.debt_ageing import OpenInvoice, days_overdue
from operatoros_api.models.customers import Customer
from operatoros_api.models.reminders import ReminderLog, ReminderSchedule, ReminderScheduleStep

MERGE_FIELDS = ("customer", "amount", "days_overdue", "oldest_invoice_date", "pay_link")


@dataclass
class DueReminder:
    customer_id: str
    customer_name: str
    schedule_id: str
    step_id: str
    step_order: int
    offset_days: int
    label: str
    channel: str
    template_key: str
    invoice: OpenInvoice
    days_overdue: int


def is_quiet_hours(now: datetime, quiet_hours_start: int, quiet_hours_end: int) -> bool:
    hour = now.hour
    if quiet_hours_start > quiet_hours_end:  # wraps midnight, e.g. 20 -> 7
        return hour >= quiet_hours_start or hour < quiet_hours_end
    return quiet_hours_start <= hour < quiet_hours_end


def render_template(
    template: str,
    *,
    customer_name: str,
    amount_minor: int,
    days_overdue_value: int,
    oldest_invoice_date: str,
    pay_link_url: str,
) -> str:
    return (
        template.replace("{customer}", customer_name)
        .replace("{amount}", str(amount_minor))
        .replace("{days_overdue}", str(days_overdue_value))
        .replace("{oldest_invoice_date}", oldest_invoice_date)
        .replace("{pay_link}", pay_link_url)
    )


async def _schedule_for_customer(
    session, business_id: str, customer_id: str
) -> ReminderSchedule | None:
    override_result = await session.execute(
        select(ReminderSchedule).where(
            ReminderSchedule.business_id == business_id,
            ReminderSchedule.customer_id == customer_id,
        )
    )
    override = override_result.scalar_one_or_none()
    if override is not None:
        return override
    default_result = await session.execute(
        select(ReminderSchedule).where(
            ReminderSchedule.business_id == business_id,
            ReminderSchedule.customer_id.is_(None),
        )
    )
    return default_result.scalar_one_or_none()


async def _steps_for_schedule(
    session, business_id: str, schedule_id: str
) -> list[ReminderScheduleStep]:
    result = await session.execute(
        select(ReminderScheduleStep)
        .where(
            ReminderScheduleStep.business_id == business_id,
            ReminderScheduleStep.schedule_id == schedule_id,
        )
        .order_by(ReminderScheduleStep.offset_days.desc())
    )
    return list(result.scalars())


async def _already_sent_for_this_invoice(
    session, business_id: str, customer_id: str, template_key: str, invoice: OpenInvoice
) -> bool:
    result = await session.execute(
        select(ReminderLog).where(
            ReminderLog.business_id == business_id,
            ReminderLog.customer_id == customer_id,
            ReminderLog.template_key == template_key,
            ReminderLog.source == "auto",
            ReminderLog.sent_at >= invoice.occurred_at,
        )
    )
    return result.first() is not None


async def _within_frequency_guardrail(
    session, business_id: str, customer_id: str, now: datetime, max_hours: int
) -> bool:
    """True if sending now would VIOLATE the guardrail (i.e. a reminder
    already went out too recently)."""
    result = await session.execute(
        select(ReminderLog)
        .where(
            ReminderLog.business_id == business_id,
            ReminderLog.customer_id == customer_id,
            ReminderLog.source == "auto",
        )
        .order_by(ReminderLog.sent_at.desc())
    )
    last = result.scalars().first()
    if last is None:
        return False
    return (now - last.sent_at) < timedelta(hours=max_hours)


def _select_due_step(
    steps: list[ReminderScheduleStep], invoice_days_overdue: int
) -> ReminderScheduleStep | None:
    for step in steps:  # already ordered offset_days descending
        if invoice_days_overdue >= step.offset_days:
            return step
    return None


async def compute_due_reminders(
    session, business_id: str, invoices_by_customer: dict[str, list[OpenInvoice]], now: datetime
) -> list[DueReminder]:
    """The core "who's due today" computation (D.6.5). `invoices_by_customer`
    is expected from `debt_ageing.open_invoices_for_business` -- callers
    already have it for the header band / accounts table, so this doesn't
    requery it."""
    customers_result = await session.execute(
        select(Customer).where(Customer.business_id == business_id)
    )
    customers = {c.id: c for c in customers_result.scalars()}

    due: list[DueReminder] = []
    for customer_id, invoices in invoices_by_customer.items():
        customer = customers.get(customer_id)
        if customer is None or customer.status == "on_hold" or not invoices:
            continue
        oldest_invoice = invoices[0]  # already sorted oldest-first
        overdue_days = days_overdue(oldest_invoice.due_date_at, now)

        schedule = await _schedule_for_customer(session, business_id, customer_id)
        if schedule is None or schedule.paused:
            continue
        if is_quiet_hours(now, schedule.quiet_hours_start, schedule.quiet_hours_end):
            continue

        steps = await _steps_for_schedule(session, business_id, schedule.id)
        step = _select_due_step(steps, overdue_days)
        if step is None:
            continue
        if await _already_sent_for_this_invoice(
            session, business_id, customer_id, step.template_key, oldest_invoice
        ):
            continue
        if await _within_frequency_guardrail(
            session, business_id, customer_id, now, schedule.max_per_customer_hours
        ):
            continue

        due.append(
            DueReminder(
                customer_id=customer_id,
                customer_name=customer.name,
                schedule_id=schedule.id,
                step_id=step.id,
                step_order=step.step_order,
                offset_days=step.offset_days,
                label=step.label,
                channel=step.channel,
                template_key=step.template_key,
                invoice=oldest_invoice,
                days_overdue=overdue_days,
            )
        )
    return due
