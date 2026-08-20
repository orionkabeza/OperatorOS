"""phase 2: reminder_log (Debt Book contact history)

Revision ID: 0012_debt_book
Revises: 0011_money_locations_payments
Create Date: 2026-08-20

Plan §1/§2. `reminder_log` backs the customer drawer's Contact history tab
(D.6.3) -- every automated reminder (`REMINDER_SENT`) plus manual "Log a
call" entries. Deliberately NOT given the `reject_direct_projection_write()`
trigger every other projection table gets: plan §1 itself describes this
table as written by both the `REMINDER_SENT` projection AND a manual
`Log a call` action, and there is no `CONTACT_LOGGED` event type in the
fixed registry to route the manual path through instead (see
models/reminders.py's module docstring and docs/DECISIONS.md).
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

revision: str = "0012_debt_book"
down_revision: str | None = "0011_money_locations_payments"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ["reminder_log"]


def upgrade() -> None:
    from operatoros_api.models.reminders import ReminderLog

    conn = op.get_bind()
    ReminderLog.metadata.create_all(bind=conn, tables=[ReminderLog.__table__])

    for table_name in TABLES:
        conn.execute(text(f'ALTER TABLE "{table_name}" ENABLE ROW LEVEL SECURITY'))
        conn.execute(text(f'ALTER TABLE "{table_name}" FORCE ROW LEVEL SECURITY'))
        conn.execute(
            text(
                f'CREATE POLICY tenant_isolation ON "{table_name}" '
                f"USING (business_id = current_setting('app.business_id', true)) "
                f"WITH CHECK (business_id = current_setting('app.business_id', true))"
            )
        )
        conn.execute(
            text(f'GRANT SELECT, INSERT, UPDATE, DELETE ON "{table_name}" TO operatoros_app')
        )


def downgrade() -> None:
    conn = op.get_bind()
    for table_name in reversed(TABLES):
        conn.execute(text(f'DROP POLICY IF EXISTS tenant_isolation ON "{table_name}"'))
    for table_name in reversed(TABLES):
        conn.execute(text(f'DROP TABLE IF EXISTS "{table_name}" CASCADE'))
