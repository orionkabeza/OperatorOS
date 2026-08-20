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

from sqlalchemy import Date, DateTime, ForeignKey, String, Text
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
