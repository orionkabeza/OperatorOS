"""phase 2: reminder_schedules, reminder_schedule_steps, customer_segments, broadcast_sends

Revision ID: 0015_reminders_segments
Revises: 0014_expenses
Create Date: 2026-08-21

Plan §1, migration group 5. All plain RLS-protected entity tables --
schedules/steps are directly CRUD'd config (D.6.5), segments store only a
filter definition (membership computed live, plan §0.7), broadcast_sends
is a plain log of past sends. None are projections; none get the
`reject_direct_projection_write()` trigger.

**A partial unique index enforces "at most one business-default schedule
per business."** `ReminderSchedule.__table_args__`'s `UniqueConstraint("business_id",
"customer_id", ...)` does NOT actually prevent two rows with
`customer_id IS NULL` for the same business -- standard SQL unique-
constraint semantics treat every `NULL` as distinct from every other
`NULL`, so a plain unique constraint on a nullable column is silently a
no-op for the NULL case specifically. `reminders_engine.py::_schedule_for_customer`'s
`.scalar_one_or_none()` lookup for the business default
(`customer_id IS NULL`) would raise `MultipleResultsFound` the moment a
second default existed -- caught for real via
`tests/test_reminders.py` once `tests/conftest.py` started seeding one
default schedule per tenant for cross-tenant isolation coverage
alongside tests that also create their own. Fixed with a genuine partial
unique index (`CREATE UNIQUE INDEX ... WHERE customer_id IS NULL`),
which Postgres does enforce correctly, plus an application-level check
in `api/routers/debt.py::create_reminder_schedule` that returns a
friendly 409 rather than a raw constraint-violation 500. See
docs/DECISIONS.md.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

revision: str = "0015_reminders_segments"
down_revision: str | None = "0014_expenses"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ["reminder_schedules", "reminder_schedule_steps", "customer_segments", "broadcast_sends"]


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
    from operatoros_api.models.reminders import ReminderSchedule, ReminderScheduleStep
    from operatoros_api.models.segments import BroadcastSend, CustomerSegment

    conn = op.get_bind()
    # reminder_schedules before reminder_schedule_steps -- the latter FKs
    # the former.
    ReminderSchedule.metadata.create_all(bind=conn, tables=[ReminderSchedule.__table__])
    ReminderScheduleStep.metadata.create_all(bind=conn, tables=[ReminderScheduleStep.__table__])
    CustomerSegment.metadata.create_all(bind=conn, tables=[CustomerSegment.__table__])
    BroadcastSend.metadata.create_all(bind=conn, tables=[BroadcastSend.__table__])

    for table_name in TABLES:
        _add_rls(conn, table_name)

    conn.execute(
        text(
            "CREATE UNIQUE INDEX uq_reminder_schedules_business_default "
            "ON reminder_schedules (business_id) WHERE customer_id IS NULL"
        )
    )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(text("DROP INDEX IF EXISTS uq_reminder_schedules_business_default"))
    for table_name in reversed(TABLES):
        conn.execute(text(f'DROP POLICY IF EXISTS tenant_isolation ON "{table_name}"'))
    for table_name in reversed(TABLES):
        conn.execute(text(f'DROP TABLE IF EXISTS "{table_name}" CASCADE'))
