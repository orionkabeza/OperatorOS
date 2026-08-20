"""Day open/close and till sessions (spec D.3/D.7.5/D.11, plan §1).

Plain entity tables, not projections — every column here is written
directly by the `day`/`till` routers in the same transaction as the
`DAY_OPENED`/`DAY_CLOSED`/`TILL_SESSION_OPENED`/`TILL_SESSION_CLOSED` event
append (never edited afterwards outside a close). `business_date` is the
anchor `daily_totals`/`staff_daily_totals`/`product_daily_movement`
(models/projections.py) key on, rather than the UTC calendar date of
`occurred_at` — see docs/DECISIONS.md for why.
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from operatoros_api.models.base import Base, TimestampMixin, UUIDPKMixin


class DaySession(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "day_sessions"
    __table_args__ = (
        Index("ix_day_sessions_business_location_status", "business_id", "location_id", "status"),
    )

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    location_id: Mapped[str] = mapped_column(
        ForeignKey("locations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    business_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="open")

    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    opened_by_user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    opening_counted_amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    opening_expected_amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    opening_variance_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    opening_variance_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_by_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    closing_counted_amount_minor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    closing_expected_amount_minor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    closing_variance_minor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    closing_variance_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    transaction_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class TillSession(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "till_sessions"
    __table_args__ = (
        Index(
            "ix_till_sessions_business_cashier_status", "business_id", "cashier_user_id", "status"
        ),
    )

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    location_id: Mapped[str] = mapped_column(
        ForeignKey("locations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    day_session_id: Mapped[str] = mapped_column(
        ForeignKey("day_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    cashier_user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="open")

    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    opening_float_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)

    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closing_counted_amount_minor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    closing_expected_amount_minor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    closing_variance_minor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
