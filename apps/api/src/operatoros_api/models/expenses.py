"""Expenses (spec D.7.4, plan §0.6/§1).

`Expense` is a plain, directly CRUD-able entity table, NOT an event and
NOT a projection -- plan §0.6 is explicit about why: "a draft/
pending_approval expense is a mutable staging row, NOT an event; only on
approval does it get appended as EXPENSE_RECORDED and marked posted."
Money only actually moves (via the ALREADY-WIRED `EXPENSE_RECORDED`
handler in `projections/money_location_balance.py`, Phase 0) the moment
`status` transitions to `posted` -- a `draft`/`pending_approval`/`rejected`
expense has no ledger effect at all, exactly like a `Sale` isn't itself an
event but drives one, except here the "event append" step is
conditional and can be permanently skipped (rejected) rather than always
happening.

`event_id` is a plain string, not a foreign key, for the same reason
`Sale.source_event_id` is (see models/sales.py's docstring) -- `events` is
range-partitioned with a composite primary key that a single-column FK
can't target.
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from operatoros_api.models.base import Base, TimestampMixin, UUIDPKMixin


class Expense(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "expenses"

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    location_id: Mapped[str] = mapped_column(
        ForeignKey("locations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    category: Mapped[str] = mapped_column(String(40), nullable=False)
    money_location: Mapped[str] = mapped_column(String(40), nullable=False)
    payee: Mapped[str | None] = mapped_column(String(200), nullable=True)
    expense_date: Mapped[date] = mapped_column(Date, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    receipt_photo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # not_attempted is the only value this phase ever sets (plan §0.6: OCR
    # pre-fill is a documented no-op seam, no OCR provider credentials
    # exist yet) -- the column exists now so a later phase's real OCR
    # integration is a data change (`succeeded`/`failed`), not a schema
    # migration.
    ocr_status: Mapped[str] = mapped_column(String(20), nullable=False, default="not_attempted")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    created_by_user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    approved_by_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    recurring_expense_id: Mapped[str | None] = mapped_column(
        ForeignKey("recurring_expenses.id", ondelete="SET NULL"), nullable=True
    )
    event_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class RecurringExpense(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "recurring_expenses"

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    location_id: Mapped[str] = mapped_column(
        ForeignKey("locations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    category: Mapped[str] = mapped_column(String(40), nullable=False)
    money_location: Mapped[str] = mapped_column(String(40), nullable=False)
    payee: Mapped[str | None] = mapped_column(String(200), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # daily | weekly | monthly -- deliberately a small fixed set (D.7.4:
    # "Recurring expenses can be scheduled") rather than full cron syntax;
    # matches the granularity spec's own prose examples imply (rent,
    # subscriptions) without building a general-purpose scheduler.
    interval: Mapped[str] = mapped_column(String(20), nullable=False)
    next_run_date: Mapped[date] = mapped_column(Date, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by_user_id: Mapped[str] = mapped_column(String(36), nullable=False)
