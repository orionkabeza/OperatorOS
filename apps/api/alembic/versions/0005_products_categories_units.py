"""phase 1: categories, units, products, product_aliases, product_locations

Revision ID: 0005_products_categories_units
Revises: 0004_audit_log
Create Date: 2026-08-20

Plan §1, migration group 1. `categories`/`units`/`products`/`product_aliases`
are plain RLS-protected entity tables (same ENABLE+FORCE+policy+GRANT
pattern as 0001). `product_locations` is the `product_stock` projection
(spec E.3) — same RLS pattern PLUS the `reject_direct_projection_write()`
trigger created in 0003_projections_and_idempotency.py, reused here rather
than redefined (`TG_TABLE_NAME`-generic, per that migration's docstring).
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

revision: str = "0005_products_categories_units"
down_revision: str | None = "0004_audit_log"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ENTITY_TABLES = ["categories", "units", "products", "product_aliases"]
PROJECTION_TABLES = ["product_locations"]


def _add_rls(conn, table_name: str) -> None:
    conn.execute(text(f'ALTER TABLE "{table_name}" ENABLE ROW LEVEL SECURITY'))
    conn.execute(text(f'ALTER TABLE "{table_name}" FORCE ROW LEVEL SECURITY'))
    conn.execute(
        text(
            f'CREATE POLICY tenant_isolation ON "{table_name}" '
            f"USING (business_id = current_setting('app.business_id', true)) "
            f"WITH CHECK (business_id = current_setting('app.business_id', true))"
        )
    )
    conn.execute(text(f'GRANT SELECT, INSERT, UPDATE, DELETE ON "{table_name}" TO operatoros_app'))


def upgrade() -> None:
    from operatoros_api.models.catalog import Category, Product, ProductAlias, ProductLocation, Unit

    conn = op.get_bind()
    Category.metadata.create_all(
        bind=conn,
        tables=[
            Category.__table__,
            Unit.__table__,
            Product.__table__,
            ProductAlias.__table__,
            ProductLocation.__table__,
        ],
    )

    for table_name in [*ENTITY_TABLES, *PROJECTION_TABLES]:
        _add_rls(conn, table_name)

    for table_name in PROJECTION_TABLES:
        conn.execute(text(f"""
                CREATE TRIGGER trg_reject_direct_write_{table_name}
                BEFORE INSERT OR UPDATE OR DELETE ON "{table_name}"
                FOR EACH ROW EXECUTE FUNCTION reject_direct_projection_write()
                """))


def downgrade() -> None:
    conn = op.get_bind()
    for table_name in PROJECTION_TABLES:
        conn.execute(
            text(f'DROP TRIGGER IF EXISTS trg_reject_direct_write_{table_name} ON "{table_name}"')
        )
    for table_name in reversed([*ENTITY_TABLES, *PROJECTION_TABLES]):
        conn.execute(text(f'DROP POLICY IF EXISTS tenant_isolation ON "{table_name}"'))
    for table_name in reversed(
        ["product_locations", "product_aliases", "products", "units", "categories"]
    ):
        conn.execute(text(f'DROP TABLE IF EXISTS "{table_name}" CASCADE'))
