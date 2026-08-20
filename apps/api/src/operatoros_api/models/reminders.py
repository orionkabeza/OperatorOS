"""`reminder_log` — the D.6.3 "Contact history" backing table (plan §1).

Written from TWO places, which is why this table is deliberately NOT
protected by the `reject_direct_projection_write()` trigger every other
projection table gets:

1. `projections/reminder_log.py`'s `REMINDER_SENT` handler, inside
   `apply_projections` (an automated reminder going out).
2. `api/routers/debt.py`'s `log-call` endpoint, directly (a manual "Log a
   call" entry recording a phone conversation and an optional
   promise-to-pay date, spec D.6.3) -- there is no `CONTACT_LOGGED` event
   type in the fixed registry (events_registry.py) and adding one is out of
   scope this phase, so this one write path is a plain entity insert, the
   same way a `Customer` profile edit is.

Plan §1 states this explicitly: "updated by REMINDER_SENT projection PLUS
a Log a call manual entry" -- a hybrid write pattern with no other
precedent in this codebase (every other projection table is projection-
framework-only). Flagged in docs/DECISIONS.md.
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from operatoros_api.models.base import Base, TimestampMixin, UUIDPKMixin


class ReminderLog(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "reminder_log"

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    customer_id: Mapped[str] = mapped_column(
        ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # "auto" (from REMINDER_SENT) or "manual_call" (Log a call).
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    # whatsapp | sms | email | call.
    channel: Mapped[str] = mapped_column(String(20), nullable=False)
    step: Mapped[str | None] = mapped_column(String(40), nullable=True)
    template_key: Mapped[str | None] = mapped_column(String(60), nullable=True)
    amount_minor: Mapped[int | None] = mapped_column(nullable=True)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    delivered_status: Mapped[str] = mapped_column(String(20), nullable=False, default="unknown")
    read_status: Mapped[str] = mapped_column(String(20), nullable=False, default="unknown")
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    promise_to_pay_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    logged_by_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    source_event_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class ReminderSchedule(Base, UUIDPKMixin, TimestampMixin):
    """Spec D.6.5: the schedule builder's top-level config -- one row is
    the business-wide default (`customer_id IS NULL`); a customer with a
    "reminder schedule override" (D.6.3's Settings tab) gets a second row
    naming them directly. `reminders_engine.py::schedule_for_customer`
    resolves per-customer override -> business default, in that order.
    """

    __tablename__ = "reminder_schedules"
    __table_args__ = (
        UniqueConstraint(
            "business_id", "customer_id", name="uq_reminder_schedules_business_customer"
        ),
    )

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    customer_id: Mapped[str | None] = mapped_column(
        ForeignKey("customers.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # D.6.5 guardrails: "a global Pause all reminders switch."
    paused: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # D.6.5: "businesses can require the owner to approve each batch of
    # reminders before sending."
    approval_mode: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # D.6.5 default: "quiet hours (no messages 8pm-7am)." Hour-of-day,
    # 0-23, business-local -- see reminders_engine.py's module docstring
    # for the timezone simplification this phase makes.
    quiet_hours_start: Mapped[int] = mapped_column(Integer, nullable=False, default=20)
    quiet_hours_end: Mapped[int] = mapped_column(Integer, nullable=False, default=7)
    # D.6.5: "a maximum of one message per customer per 48 hours across
    # all sequences."
    max_per_customer_hours: Mapped[int] = mapped_column(Integer, nullable=False, default=48)


class ReminderScheduleStep(Base, UUIDPKMixin, TimestampMixin):
    """One step of a schedule (D.6.5): `−3 days: friendly nudge`, `Due
    date: it's due today`, etc. `offset_days` is relative to the invoice's
    `due_date_at` -- negative before, zero on the day, positive after.
    `templates` is a `{language_code: template_body}` map (D.6.5: "editable
    per step, per language"), the same JSONB-map-over-a-fixed-set pattern
    `DailyTotals.by_payment_method` already uses for a similar reason (the
    key set -- languages a business supports -- isn't fixed enough to be
    worth one column each).
    """

    __tablename__ = "reminder_schedule_steps"
    __table_args__ = (
        UniqueConstraint(
            "business_id", "schedule_id", "step_order", name="uq_reminder_steps_schedule_order"
        ),
    )

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    schedule_id: Mapped[str] = mapped_column(
        ForeignKey("reminder_schedules.id", ondelete="CASCADE"), nullable=False, index=True
    )
    step_order: Mapped[int] = mapped_column(Integer, nullable=False)
    offset_days: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[str] = mapped_column(String(80), nullable=False)
    # D.6.5: "Channels: WhatsApp (primary), SMS fallback if WhatsApp
    # undelivered after 2 hours, email if on file." `channel` here is the
    # PRIMARY channel for the step; the WhatsApp -> SMS fallback-after-2h
    # rule is documented as a known gap this phase doesn't implement (see
    # docs/DECISIONS.md) -- it needs a delivery-status callback from a
    # real WhatsApp Business API integration (Phase 5) to know "undelivered
    # after 2 hours" at all, which the console-logged `NotificationSender`
    # stub cannot provide.
    channel: Mapped[str] = mapped_column(String(20), nullable=False, default="whatsapp")
    template_key: Mapped[str] = mapped_column(String(60), nullable=False)
    templates: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
