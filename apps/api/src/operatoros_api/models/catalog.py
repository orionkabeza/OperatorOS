"""Product catalog entity tables (spec E.4, plan §1): categories, units,
products, aliases, and per-location stock.

`ProductLocation` is deliberately BOTH the plan's §1 entity table
("product_locations (on-hand qty per product per location — the
product_stock projection's backing table)") and the spec E.3 `product_stock`
projection -- there is only one table, not a duplicated pair kept in sync.
It is written to exclusively by `projections/product_stock.py` through the
same `app.projection_writer` trigger-gated path as `money_location_balance`
(see alembic/versions/0006_phase1_projection_tables.py).

`available` (spec E.3: on_hand minus reserved) is deliberately NOT a stored
column -- `reserved` has no writer in Phase 1 (purchase orders/reservations
are Phase 3), so it is always 0 and `available` always equals `on_hand`.
Storing a third number that must be kept in sync with the other two for no
current benefit is exactly the kind of derived-state duplication the
ledger-first architecture exists to avoid; it's computed in the response
schema (`schemas/stock.py`) instead.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from operatoros_api.models.base import Base, TimestampMixin, UUIDPKMixin


class Category(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "categories"
    __table_args__ = (UniqueConstraint("business_id", "name", name="uq_categories_business_name"),)

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)


class Unit(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "units"
    __table_args__ = (UniqueConstraint("business_id", "name", name="uq_units_business_name"),)

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(40), nullable=False)
    symbol: Mapped[str] = mapped_column(String(10), nullable=False)


class Product(Base, UUIDPKMixin, TimestampMixin):
    """Unit conversion factors (spec D.5.2: "1 box = 12 pieces") are a known
    Phase 1 gap -- `base_unit_id` is the only unit a product is tracked in.
    See docs/DECISIONS.md."""

    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("business_id", "sku", name="uq_products_business_sku"),
        UniqueConstraint("business_id", "barcode", name="uq_products_business_barcode"),
    )

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    category_id: Mapped[str | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    base_unit_id: Mapped[str] = mapped_column(
        ForeignKey("units.id", ondelete="RESTRICT"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    sku: Mapped[str | None] = mapped_column(String(60), nullable=True)
    barcode: Mapped[str | None] = mapped_column(String(60), nullable=True)
    cost_price_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    selling_price_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    min_selling_price_minor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    tax_class: Mapped[str] = mapped_column(String(20), nullable=False, default="standard")
    reorder_point: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=0)
    reorder_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")


class ProductAlias(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "product_aliases"

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[str] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    alias: Mapped[str] = mapped_column(String(200), nullable=False)


class ProductLocation(Base, UUIDPKMixin, TimestampMixin):
    """The `product_stock` projection (spec E.3). Written only from inside
    `projections/product_stock.py::apply_projections` — see module docstring."""

    __tablename__ = "product_locations"
    __table_args__ = (
        UniqueConstraint(
            "business_id", "location_id", "product_id", name="uq_product_locations_product_loc"
        ),
    )

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    location_id: Mapped[str] = mapped_column(
        ForeignKey("locations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[str] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    on_hand: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=0)
    reserved: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=0)
    avg_cost_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    frozen: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_event_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    updated_at_ledger: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
