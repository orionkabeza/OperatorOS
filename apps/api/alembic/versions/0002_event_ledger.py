"""event ledger: partitioned events table + RLS

Revision ID: 0002_event_ledger
Revises: 0001_tenancy_and_rls
Create Date: 2026-08-19

`events` (spec E.2 envelope) is RANGE-partitioned by month on
`occurred_at`, written as raw DDL because SQLAlchemy's declarative layer
doesn't model native Postgres partitioning (models/events.py documents
this). RLS policy + indexes are defined on the partitioned PARENT table:
Postgres (12+) automatically applies both the policy and any index defined
on the parent to every partition, including ones created after the fact,
as long as access goes through the parent table name (which is all the
app ever does).

Partitions are pre-created for a 5-year span (2024-01 through 2028-12) so
Phase 0 doesn't need a partition-maintenance job yet. A real deployment
needs a scheduled job creating next month's partition ahead of time --
tracked in docs/DECISIONS.md as deliberately out of Phase 0 scope.

The app role gets SELECT + INSERT only, no UPDATE/DELETE: the ledger's
append-only guarantee (spec E.1) is enforced at the database privilege
level, not just by application convention.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date

from alembic import op
from sqlalchemy import text

revision: str = "0002_event_ledger"
down_revision: str | None = "0001_tenancy_and_rls"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PARTITION_START = date(2024, 1, 1)
PARTITION_MONTHS = 60  # 2024-01 through 2028-12


def _add_months(d: date, months: int) -> date:
    total = d.month - 1 + months
    year = d.year + total // 12
    month = total % 12 + 1
    return date(year, month, 1)


def upgrade() -> None:
    conn = op.get_bind()

    conn.execute(
        text(
            """
            CREATE TABLE events (
                id varchar(36) NOT NULL,
                business_id varchar(36) NOT NULL,
                location_id varchar(36),
                type varchar(60) NOT NULL,
                payload jsonb NOT NULL,
                occurred_at timestamptz NOT NULL,
                recorded_at timestamptz NOT NULL,
                actor_user_id varchar(36),
                actor_source varchar(20) NOT NULL,
                device_id varchar(100),
                correlation_id varchar(36) NOT NULL,
                reverses_event_id varchar(36),
                corrects_event_id varchar(36),
                schema_version integer NOT NULL,
                idempotency_key text,
                PRIMARY KEY (id, occurred_at)
            ) PARTITION BY RANGE (occurred_at)
            """
        )
    )

    conn.execute(text("CREATE INDEX ix_events_business_occurred ON events (business_id, occurred_at)"))
    conn.execute(
        text(
            "CREATE INDEX ix_events_business_type_occurred ON events (business_id, type, occurred_at)"
        )
    )

    conn.execute(text("ALTER TABLE events ENABLE ROW LEVEL SECURITY"))
    conn.execute(text("ALTER TABLE events FORCE ROW LEVEL SECURITY"))
    conn.execute(
        text(
            "CREATE POLICY tenant_isolation ON events "
            "USING (business_id = current_setting('app.business_id', true)) "
            "WITH CHECK (business_id = current_setting('app.business_id', true))"
        )
    )
    conn.execute(text("GRANT SELECT, INSERT ON events TO operatoros_app"))

    for i in range(PARTITION_MONTHS):
        month_start = _add_months(PARTITION_START, i)
        month_end = _add_months(PARTITION_START, i + 1)
        partition_name = f"events_{month_start:%Y_%m}"
        conn.execute(
            text(
                f'CREATE TABLE "{partition_name}" PARTITION OF events '
                f"FOR VALUES FROM ('{month_start.isoformat()}') TO ('{month_end.isoformat()}')"
            )
        )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(text("DROP TABLE IF EXISTS events CASCADE"))
