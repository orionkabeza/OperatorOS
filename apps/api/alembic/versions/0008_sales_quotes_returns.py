"""phase 1: receipt_sequences, sales, sale_lines, sale_payments, receipts,
quotes, quote_lines, returns, return_lines

Revision ID: 0008_sales_quotes_returns
Revises: 0007_day_till_sessions
Create Date: 2026-08-20

Plan §1, migration group 4. All plain RLS-protected entity tables (spec
D.4/D.5.4-adjacent, E.4) — written directly by `api/routers/sales.py` in
the same transaction as the `SALE_RECORDED`/`QUOTE_ISSUED`/`QUOTE_CONVERTED`/
`RETURN_RECORDED` event append, never through the projection framework
(see models/sales.py module docstring for why these are durable records in
their own right, not projections).
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

revision: str = "0008_sales_quotes_returns"
down_revision: str | None = "0007_day_till_sessions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# receipt_sequences has no business_id *column named that* used as a normal
# FK-referenced business row -- it uses business_id as its own primary key
# (models/sales.py::ReceiptSequence). It still gets the identical RLS
# treatment: the tenant_isolation policy reads/writes exactly the same way.
TABLES = [
    "receipt_sequences",
    "sales",
    "sale_lines",
    "sale_payments",
    "receipts",
    "quotes",
    "quote_lines",
    "returns",
    "return_lines",
]


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
    from operatoros_api.models.sales import (
        Quote,
        QuoteLine,
        Receipt,
        ReceiptSequence,
        Return,
        ReturnLine,
        Sale,
        SaleLine,
        SalePayment,
    )

    conn = op.get_bind()
    Sale.metadata.create_all(
        bind=conn,
        tables=[
            ReceiptSequence.__table__,
            Sale.__table__,
            SaleLine.__table__,
            SalePayment.__table__,
            Receipt.__table__,
            Quote.__table__,
            QuoteLine.__table__,
            Return.__table__,
            ReturnLine.__table__,
        ],
    )

    for table_name in TABLES:
        _add_rls(conn, table_name)


def downgrade() -> None:
    conn = op.get_bind()
    for table_name in reversed(TABLES):
        conn.execute(text(f'DROP POLICY IF EXISTS tenant_isolation ON "{table_name}"'))
    for table_name in reversed(TABLES):
        conn.execute(text(f'DROP TABLE IF EXISTS "{table_name}" CASCADE'))
