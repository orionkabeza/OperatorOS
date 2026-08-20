"""phase 1: customers, customer_balances

Revision ID: 0006_customers
Revises: 0005_products_categories_units
Create Date: 2026-08-20

Plan §1, migration group 2. `customers` is a plain RLS-protected entity
table. `customer_balances` is the `customer_balance` projection (spec E.3)
plus `credit_limit_minor` — see models/customers.py module docstring for
why it's a separate table rather than columns on `customers` itself.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

revision: str = "0006_customers"
down_revision: str | None = "0005_products_categories_units"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ENTITY_TABLES = ["customers"]
PROJECTION_TABLES = ["customer_balances"]


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
    from operatoros_api.models.customers import Customer, CustomerBalance

    conn = op.get_bind()
    Customer.metadata.create_all(bind=conn, tables=[Customer.__table__, CustomerBalance.__table__])

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
    for table_name in ["customer_balances", "customers"]:
        conn.execute(text(f'DROP TABLE IF EXISTS "{table_name}" CASCADE'))
