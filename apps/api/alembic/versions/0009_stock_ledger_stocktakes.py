"""phase 1: stock_movements, stocktakes, stocktake_lines, stock_transfers,
stock_transfer_lines

Revision ID: 0009_stock_ledger_stocktakes
Revises: 0008_sales_quotes_returns
Create Date: 2026-08-20

Plan §1, migration group 5 (stock_movements/stocktakes/transfers — the
revision id is shortened to fit alembic_version.version_num's VARCHAR(32),
same constraint 0003_projections_and_idempotency's id (exactly 32 chars)
was already up against; see docs/DECISIONS.md). `stock_movements` (spec
D.5.3) is the append-only stock ledger, written only from inside
`projections/product_stock.py` alongside `product_locations` — same
`reject_direct_projection_write()` trigger. `stocktakes`/`stocktake_lines`/
`stock_transfers`/`stock_transfer_lines` are plain entity tables driving
the D.5.4/D.5.5 workflows (see models/stock.py module docstring).
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

revision: str = "0009_stock_ledger_stocktakes"
down_revision: str | None = "0008_sales_quotes_returns"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PROJECTION_TABLES = ["stock_movements"]
ENTITY_TABLES = ["stocktakes", "stocktake_lines", "stock_transfers", "stock_transfer_lines"]


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
    from operatoros_api.models.stock import (
        StockMovement,
        Stocktake,
        StocktakeLine,
        StockTransfer,
        StockTransferLine,
    )

    conn = op.get_bind()
    StockMovement.metadata.create_all(
        bind=conn,
        tables=[
            StockMovement.__table__,
            Stocktake.__table__,
            StocktakeLine.__table__,
            StockTransfer.__table__,
            StockTransferLine.__table__,
        ],
    )

    for table_name in [*PROJECTION_TABLES, *ENTITY_TABLES]:
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
    for table_name in reversed([*PROJECTION_TABLES, *ENTITY_TABLES]):
        conn.execute(text(f'DROP POLICY IF EXISTS tenant_isolation ON "{table_name}"'))
    for table_name in reversed(
        [
            "stock_movements",
            "stocktakes",
            "stocktake_lines",
            "stock_transfers",
            "stock_transfer_lines",
        ]
    ):
        conn.execute(text(f'DROP TABLE IF EXISTS "{table_name}" CASCADE'))
