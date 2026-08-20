"""phase 2: expenses, recurring_expenses

Revision ID: 0014_expenses
Revises: 0013_cashbox_momo
Create Date: 2026-08-21

Plan §1, migration group 4. Both plain RLS-protected entity tables --
`expenses` is explicitly NOT an event or a projection (plan §0.6: "a
draft/pending_approval expense is a mutable staging row, NOT an event;
only on approval does it get appended as EXPENSE_RECORDED"), so neither
table gets the `reject_direct_projection_write()` trigger.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

revision: str = "0014_expenses"
down_revision: str | None = "0013_cashbox_momo"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ["recurring_expenses", "expenses"]


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
    from operatoros_api.models.expenses import Expense, RecurringExpense

    conn = op.get_bind()
    # recurring_expenses first -- expenses.recurring_expense_id references it.
    RecurringExpense.metadata.create_all(bind=conn, tables=[RecurringExpense.__table__])
    Expense.metadata.create_all(bind=conn, tables=[Expense.__table__])

    for table_name in TABLES:
        _add_rls(conn, table_name)


def downgrade() -> None:
    conn = op.get_bind()
    for table_name in TABLES:
        conn.execute(text(f'DROP POLICY IF EXISTS tenant_isolation ON "{table_name}"'))
    for table_name in TABLES:
        conn.execute(text(f'DROP TABLE IF EXISTS "{table_name}" CASCADE'))
