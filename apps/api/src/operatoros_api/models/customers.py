"""Customers (spec E.4, plan §1/§0.2).

Split into two tables, the same shape as `money_location_balance` vs. the
tables that reference it, and for the same reason (docs/DECISIONS.md
"Projection write protection: a DB trigger + GUC marker"):

- `Customer` — a plain entity table (name/phone/terms/language/status).
  Directly CRUD-able (POST/PATCH `/api/v1/customers`) because there is no
  `CUSTOMER_UPDATED` event in the registry for a simple profile edit — only
  `CUSTOMER_CREATED` (creation) and `CREDIT_LIMIT_CHANGED` exist, and adding
  a new event type is explicitly out of scope this phase.
- `CustomerBalance` — the spec E.3 `customer_balance` projection
  (`balance`, `oldest_unpaid_at`, `limit_used`) PLUS `credit_limit_minor`,
  which plan §2 lists as driven by the `CREDIT_LIMIT_CHANGED` event same as
  balance is driven by `SALE_RECORDED`/`RETURN_RECORDED`. Protected by the
  same `reject_direct_projection_write()` trigger as `money_location_balance`
  and `product_locations` — money-shaped state that must only ever move
  through the projection framework, never a direct UPDATE.

A single `customers` table carrying both would force the trigger onto
ordinary profile-edit writes too (or leave the money fields unprotected on
a table that also takes direct writes) — the split keeps "only the
projection framework writes projection tables" true with no carve-out.

`limit_used` (spec E.3) is not stored — like `available` on
`ProductLocation`, it is `balance_minor / credit_limit_minor`, computed in
the response schema.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from operatoros_api.models.base import Base, TimestampMixin, UUIDPKMixin


class Customer(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "customers"

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    phone_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    terms_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    language: Mapped[str] = mapped_column(String(5), nullable=False, default="en")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")


class CustomerBalance(Base, UUIDPKMixin, TimestampMixin):
    """The `customer_balance` projection. Written only from inside
    `projections/customer_balance.py`."""

    __tablename__ = "customer_balances"
    __table_args__ = (
        UniqueConstraint("business_id", "customer_id", name="uq_customer_balances_customer"),
    )

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    customer_id: Mapped[str] = mapped_column(
        ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    credit_limit_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    balance_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    oldest_unpaid_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Plan §2: DEBT_WRITTEN_OFF sets balance -> 0 and stamps written_off_at.
    # `written_off` is a plain derived convenience (`written_off_at is not
    # None`) stored as its own column rather than computed in every query --
    # spec D.6.6: "Written-off customers stay visible with a Written off
    # chip," so this needs to be a fast, indexable filter, not a per-row
    # Python computation in the accounts-list endpoint.
    written_off: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    written_off_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_event_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    updated_at_ledger: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
