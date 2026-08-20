"""phase 1: day_sessions, till_sessions

Revision ID: 0007_day_till_sessions
Revises: 0006_customers
Create Date: 2026-08-20

Plan §1, migration group 3. Plain RLS-protected entity tables (spec
D.3/D.7.5/D.11) — no projection trigger, they are written directly by the
`day`/`till` routers.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

revision: str = "0007_day_till_sessions"
down_revision: str | None = "0006_customers"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ["day_sessions", "till_sessions"]


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
    from operatoros_api.models.day_till import DaySession, TillSession

    conn = op.get_bind()
    DaySession.metadata.create_all(bind=conn, tables=[DaySession.__table__, TillSession.__table__])

    for table_name in TABLES:
        _add_rls(conn, table_name)


def downgrade() -> None:
    conn = op.get_bind()
    for table_name in reversed(TABLES):
        conn.execute(text(f'DROP POLICY IF EXISTS tenant_isolation ON "{table_name}"'))
    for table_name in ["till_sessions", "day_sessions"]:
        conn.execute(text(f'DROP TABLE IF EXISTS "{table_name}" CASCADE'))
