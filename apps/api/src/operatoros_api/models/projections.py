"""Projection (read-model) tables.

Phase 0 implemented one real, end-to-end projection — `money_location_balance`
— to prove the machinery. Phase 1 (plan §2) adds the rest of spec E.3's
list that this phase's events drive: `product_stock` (models/catalog.py's
`ProductLocation` — see that module's docstring for why it lives there
rather than here) and `customer_balance` (models/customers.py's
`CustomerBalance`, same reasoning), plus three new ones defined here:
`daily_totals`, `staff_daily_totals`, and `product_daily_movement`, which
back the Overview's "Today" and "Top and bottom" sections (spec D.10.1).
All three key on `business_date` (the day session's date, not the UTC
calendar date of `occurred_at`) — see docs/DECISIONS.md.

Every table below is protected by the same
`reject_direct_projection_write()` trigger as `money_location_balance` —
written only from inside `projections/daily_totals.py`.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
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


class DailyTotals(Base, UUIDPKMixin, TimestampMixin):
    """Backs D.10.1 "Today" and D.11's day-close summary card. `by_payment_method`
    is a `{method: amount_minor}` JSON map rather than one column per payment
    method — the payment method set (spec D.4: Cash/MoMo/Airtel/Bank/Card/Cheque)
    is fixed today but not a schema-worthy enum to hard-code into columns."""

    __tablename__ = "daily_totals"
    __table_args__ = (
        UniqueConstraint(
            "business_id", "location_id", "business_date", name="uq_daily_totals_business_date"
        ),
    )

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    location_id: Mapped[str] = mapped_column(
        ForeignKey("locations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    business_date: Mapped[date] = mapped_column(Date, nullable=False)
    revenue_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    discount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    tax_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    credit_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    by_payment_method: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    transaction_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    returns_amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    returns_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_event_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    updated_at_ledger: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class StaffDailyTotals(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "staff_daily_totals"
    __table_args__ = (
        UniqueConstraint(
            "business_id",
            "location_id",
            "business_date",
            "staff_user_id",
            name="uq_staff_daily_totals_business_date_staff",
        ),
    )

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    location_id: Mapped[str] = mapped_column(
        ForeignKey("locations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    business_date: Mapped[date] = mapped_column(Date, nullable=False)
    staff_user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    sales_amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    discount_given_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    transaction_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    returns_amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    last_event_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    updated_at_ledger: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class ProductDailyMovement(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "product_daily_movement"
    __table_args__ = (
        UniqueConstraint(
            "business_id",
            "location_id",
            "business_date",
            "product_id",
            name="uq_product_daily_movement_business_date_product",
        ),
    )

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    location_id: Mapped[str] = mapped_column(
        ForeignKey("locations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    business_date: Mapped[date] = mapped_column(Date, nullable=False)
    product_id: Mapped[str] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    quantity_sold: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=0)
    revenue_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    quantity_returned: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=0)
    last_event_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    updated_at_ledger: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
