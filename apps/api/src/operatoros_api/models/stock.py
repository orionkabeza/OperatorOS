"""Stock movements ledger, stocktakes, and transfers (spec D.5.3/D.5.4/D.5.5,
plan §1).

`StockMovement` (D.5.3: "a single filterable ledger of every movement...
read-only... the screen you open when the numbers look wrong") is written
ONLY from inside `projections/product_stock.py`, alongside the
`product_locations` update, in the same transaction as the event append —
same `reject_direct_projection_write()` trigger protection as
`product_locations` and `money_location_balance` (docs/DECISIONS.md).

`Stocktake`/`StocktakeLine`/`StockTransfer`/`StockTransferLine` are plain
entity tables driving the stocktake and transfer *workflows*
(start → count → review → post; create → in-transit → receive) — the
counting/review/in-transit states have no event of their own (only the
terminal `STOCKTAKE_POSTED`/`STOCK_TRANSFERRED_OUT`/`STOCK_TRANSFERRED_IN`
do, per events_registry.py), so the in-progress workflow state is tracked
directly the same way `Sale`/`Quote`/`Return` are.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from operatoros_api.models.base import Base, TimestampMixin, UUIDPKMixin


class StockMovement(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "stock_movements"

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    location_id: Mapped[str] = mapped_column(
        ForeignKey("locations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[str] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    movement_type: Mapped[str] = mapped_column(String(30), nullable=False)
    quantity_delta: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    running_balance: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    unit_cost_minor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    reference_type: Mapped[str] = mapped_column(String(30), nullable=False)
    reference_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    source_event_id: Mapped[str] = mapped_column(String(36), nullable=False)
    actor_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Stocktake(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "stocktakes"

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    location_id: Mapped[str] = mapped_column(
        ForeignKey("locations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    scope: Mapped[str] = mapped_column(String(20), nullable=False)
    scope_filter: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    freeze_during_count: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="counting")
    started_by_user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    posted_by_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    variance_value_minor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    line_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_event_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class StocktakeLine(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "stocktake_lines"

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    stocktake_id: Mapped[str] = mapped_column(
        ForeignKey("stocktakes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[str] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    expected_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    counted_quantity: Mapped[Decimal | None] = mapped_column(Numeric(18, 4), nullable=True)
    counted_by_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    counted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    variance_qty: Mapped[Decimal | None] = mapped_column(Numeric(18, 4), nullable=True)
    variance_value_minor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)


class StockTransfer(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "stock_transfers"

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    from_location_id: Mapped[str] = mapped_column(
        ForeignKey("locations.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    to_location_id: Mapped[str] = mapped_column(
        ForeignKey("locations.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="in_transit")
    created_by_user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    received_by_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    send_source_event_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class StockTransferLine(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "stock_transfer_lines"

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    transfer_id: Mapped[str] = mapped_column(
        ForeignKey("stock_transfers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[str] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    quantity_sent: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    quantity_received: Mapped[Decimal | None] = mapped_column(Numeric(18, 4), nullable=True)
    discrepancy: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    receive_source_event_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
