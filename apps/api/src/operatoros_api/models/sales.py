"""Sales, quotes, returns, and receipts (spec D.4/D.5.4 note, E.4, plan §1).

Plain entity tables — the atomic sale write (the safety-critical path,
`api/routers/sales.py`) inserts `Sale`/`SaleLine`/`SalePayment`/`Receipt`
rows directly, in the SAME transaction as the `SALE_RECORDED` event append
and the projection updates it drives (`product_locations`,
`customer_balances`, `money_location_balance`, `daily_totals`, ...). These
are the durable, queryable, joinable record of the sale itself; the event
is the immutable fact that drove them into existence. Neither is a
substitute for the other — see docs/DECISIONS.md.

`ReceiptSequence` gives each business a gap-free, race-free receipt number
sequence: `UPDATE receipt_sequences SET next_number = next_number + 1
WHERE business_id = :bid RETURNING next_number - 1` inside the sale's own
transaction blocks a second concurrent sale for the same business on the
row lock until the first commits or rolls back — no separate advisory lock
needed, same reasoning as the idempotency key's `INSERT ... ON CONFLICT`
(docs/DECISIONS.md "Idempotency store is Postgres, not Redis").
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from operatoros_api.models.base import Base, TimestampMixin, UUIDPKMixin


class ReceiptSequence(Base):
    __tablename__ = "receipt_sequences"

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), primary_key=True
    )
    next_number: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)


class Sale(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "sales"

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    location_id: Mapped[str] = mapped_column(
        ForeignKey("locations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    day_session_id: Mapped[str] = mapped_column(
        ForeignKey("day_sessions.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    till_session_id: Mapped[str | None] = mapped_column(
        ForeignKey("till_sessions.id", ondelete="SET NULL"), nullable=True
    )
    customer_id: Mapped[str | None] = mapped_column(
        ForeignKey("customers.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    cashier_user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    subtotal_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    discount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    tax_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    total_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="completed")
    credit_override_by_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    credit_override_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_event_id: Mapped[str] = mapped_column(String(36), nullable=False)
    reversal_event_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class SaleLine(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "sale_lines"

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sale_id: Mapped[str] = mapped_column(
        ForeignKey("sales.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[str] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    unit_price_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    line_discount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    tax_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    line_total_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)


class SalePayment(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "sale_payments"

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sale_id: Mapped[str] = mapped_column(
        ForeignKey("sales.id", ondelete="CASCADE"), nullable=False, index=True
    )
    method: Mapped[str] = mapped_column(String(20), nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    reference: Mapped[str | None] = mapped_column(String(200), nullable=True)


class Receipt(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "receipts"

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sale_id: Mapped[str] = mapped_column(
        ForeignKey("sales.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    receipt_number: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    send_channel: Mapped[str] = mapped_column(String(20), nullable=False, default="none")
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Quote(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "quotes"

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    location_id: Mapped[str] = mapped_column(
        ForeignKey("locations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    customer_id: Mapped[str | None] = mapped_column(
        ForeignKey("customers.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    quote_number: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    created_by_user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    subtotal_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    discount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    tax_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    total_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    converted_sale_id: Mapped[str | None] = mapped_column(
        ForeignKey("sales.id", ondelete="SET NULL"), nullable=True
    )
    source_event_id: Mapped[str] = mapped_column(String(36), nullable=False)


class QuoteLine(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "quote_lines"

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    quote_id: Mapped[str] = mapped_column(
        ForeignKey("quotes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[str] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    unit_price_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    line_total_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)


class Return(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "returns"

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    location_id: Mapped[str] = mapped_column(
        ForeignKey("locations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sale_id: Mapped[str] = mapped_column(
        ForeignKey("sales.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    customer_id: Mapped[str | None] = mapped_column(
        ForeignKey("customers.id", ondelete="RESTRICT"), nullable=True
    )
    refund_method: Mapped[str] = mapped_column(String(20), nullable=False)
    refund_amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    created_by_user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    source_event_id: Mapped[str] = mapped_column(String(36), nullable=False)


class ReturnLine(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "return_lines"

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    return_id: Mapped[str] = mapped_column(
        ForeignKey("returns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[str] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    unit_price_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    line_total_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    restock: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
