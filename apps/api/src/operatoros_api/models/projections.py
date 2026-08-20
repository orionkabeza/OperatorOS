"""Projection (read-model) tables.

Phase 0 implements one real, end-to-end projection — `money_location_balance`
— to prove the machinery: transactional-with-the-event update, a DB trigger
rejecting any direct write outside the projection-writing path, and the
nightly audit job that recomputes it from the event log. The remaining
projections named in spec E.3 (`product_stock`, `customer_balance`, ...)
are schema-only follow-on work for the phases that introduce the events
which drive them (see docs/plans/phase-0.md §3, "Phase 0 scope note").
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from operatoros_api.models.base import Base, TimestampMixin, UUIDPKMixin


class MoneyLocationBalance(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "money_location_balance"
    __table_args__ = (
        UniqueConstraint(
            "business_id",
            "location_id",
            "account_key",
            name="uq_money_location_balance_account",
        ),
    )

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    location_id: Mapped[str] = mapped_column(
        ForeignKey("locations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    account_key: Mapped[str] = mapped_column(String(40), nullable=False)
    balance_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="RWF")
    last_event_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    updated_at_ledger: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
