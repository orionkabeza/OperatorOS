"""phase 2: money_locations, payment_allocations, sales.due_date_at, customer_balances write-off columns

Revision ID: 0011_money_locations_payments
Revises: 0010_phase1_daily_projections
Create Date: 2026-08-20

Plan §1, migration group 1. Two new entity tables (`money_locations` --
Cash Box account display metadata; `payment_allocations` -- which
invoice(s) a payment was allocated to, plan §0.2) plus two column additions
on existing tables: `sales.due_date_at` (a credit sale's invoice due date,
snapshotted at sale time) and `customer_balances.written_off`/
`written_off_at` (DEBT_WRITTEN_OFF, plan §2).

Neither new table is a projection -- both are written directly by
`api/routers/debt.py`/`api/routers/cashbox.py`, same as `customers` or
`sales` -- so neither gets the `reject_direct_projection_write()` trigger,
only ordinary RLS `ENABLE`+`FORCE`.

**Column additions use `ADD COLUMN IF NOT EXISTS`, not plain `op.add_column`**
-- see docs/DECISIONS.md ("Column-adding migrations use IF NOT EXISTS,
because CREATE-step migrations use live ORM classes"). Every earlier
migration creates its table via `SomeModel.metadata.create_all(...)`
against the CURRENT (not historical) model class, so replaying every
migration from scratch against a fresh database -- exactly what
tests/conftest.py does for every test run -- means migration 0006 already
creates `customer_balances` WITH `written_off`/`written_off_at`, because
those fields are now part of the live `CustomerBalance` class by the time
0006 runs, even though this migration (0011) is where they were
introduced. A plain `op.add_column` here would then collide with a column
0006 already created and fail the whole suite. `IF NOT EXISTS` makes this
correct in both directions: a fresh-DB replay (column already there,
no-op) and a real incremental production upgrade of an already-deployed
database that only ever ran migrations 0001-0010 (column genuinely
missing, added normally).
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

revision: str = "0011_money_locations_payments"
down_revision: str | None = "0010_phase1_daily_projections"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ENTITY_TABLES = ["money_locations", "payment_allocations"]


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
    from operatoros_api.models.money_locations import MoneyLocation
    from operatoros_api.models.payments import PaymentAllocation

    conn = op.get_bind()
    MoneyLocation.metadata.create_all(
        bind=conn, tables=[MoneyLocation.__table__, PaymentAllocation.__table__]
    )

    for table_name in ENTITY_TABLES:
        _add_rls(conn, table_name)

    conn.execute(text("ALTER TABLE sales ADD COLUMN IF NOT EXISTS due_date_at TIMESTAMPTZ"))
    conn.execute(
        text(
            "ALTER TABLE customer_balances ADD COLUMN IF NOT EXISTS "
            "written_off BOOLEAN NOT NULL DEFAULT false"
        )
    )
    conn.execute(
        text("ALTER TABLE customer_balances ADD COLUMN IF NOT EXISTS written_off_at TIMESTAMPTZ")
    )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(text("ALTER TABLE customer_balances DROP COLUMN IF EXISTS written_off_at"))
    conn.execute(text("ALTER TABLE customer_balances DROP COLUMN IF EXISTS written_off"))
    conn.execute(text("ALTER TABLE sales DROP COLUMN IF EXISTS due_date_at"))
    for table_name in reversed(ENTITY_TABLES):
        conn.execute(text(f'DROP POLICY IF EXISTS tenant_isolation ON "{table_name}"'))
    for table_name in reversed(ENTITY_TABLES):
        conn.execute(text(f'DROP TABLE IF EXISTS "{table_name}" CASCADE'))
