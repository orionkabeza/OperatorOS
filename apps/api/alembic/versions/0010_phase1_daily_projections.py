"""phase 1: daily_totals, staff_daily_totals, product_daily_movement

Revision ID: 0010_phase1_daily_projections
Revises: 0009_stock_movements_stocktakes_transfers
Create Date: 2026-08-20

Plan §2. The three remaining spec E.3 projections this phase introduces,
backing the Overview's "Today" and "Top and bottom" sections (D.10.1).
Same `reject_direct_projection_write()` trigger protection as every other
projection table — written only from inside `projections/daily_totals.py`.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

revision: str = "0010_phase1_daily_projections"
down_revision: str | None = "0009_stock_ledger_stocktakes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ["daily_totals", "staff_daily_totals", "product_daily_movement"]


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
    from operatoros_api.models.projections import (
        DailyTotals,
        ProductDailyMovement,
        StaffDailyTotals,
    )

    conn = op.get_bind()
    DailyTotals.metadata.create_all(
        bind=conn,
        tables=[
            DailyTotals.__table__,
            StaffDailyTotals.__table__,
            ProductDailyMovement.__table__,
        ],
    )

    for table_name in TABLES:
        _add_rls(conn, table_name)
        conn.execute(text(f"""
                CREATE TRIGGER trg_reject_direct_write_{table_name}
                BEFORE INSERT OR UPDATE OR DELETE ON "{table_name}"
                FOR EACH ROW EXECUTE FUNCTION reject_direct_projection_write()
                """))


def downgrade() -> None:
    conn = op.get_bind()
    for table_name in TABLES:
        conn.execute(
            text(f'DROP TRIGGER IF EXISTS trg_reject_direct_write_{table_name} ON "{table_name}"')
        )
        conn.execute(text(f'DROP POLICY IF EXISTS tenant_isolation ON "{table_name}"'))
    for table_name in reversed(TABLES):
        conn.execute(text(f'DROP TABLE IF EXISTS "{table_name}" CASCADE'))
