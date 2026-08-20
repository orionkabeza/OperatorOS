"""projections (money_location_balance) + idempotency_keys + write-guard trigger

Revision ID: 0003_projections_and_idempotency
Revises: 0002_event_ledger
Create Date: 2026-08-19

Adds the one real Phase 0 projection table and the Postgres-backed
idempotency store, both RLS-protected, plus the trigger that makes "only
the projection framework may write to a projection table" a database-
enforced fact rather than a convention: `reject_direct_projection_write()`
checks the `app.projection_writer` session GUC (set only by
projections/framework.py, only for the duration of applying a projection,
in the same transaction as the event append) and raises otherwise. See
tests/test_projection_trigger.py for a raw UPDATE that proves this.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

revision: str = "0003_projections_and_idempotency"
down_revision: str | None = "0002_event_ledger"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

RLS_TABLES = ["money_location_balance", "idempotency_keys"]


def upgrade() -> None:
    from operatoros_api.models.idempotency import IdempotencyKey
    from operatoros_api.models.projections import MoneyLocationBalance

    conn = op.get_bind()
    MoneyLocationBalance.metadata.create_all(
        bind=conn, tables=[MoneyLocationBalance.__table__, IdempotencyKey.__table__]
    )

    for table_name in RLS_TABLES:
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

    conn.execute(
        text(
            """
            CREATE OR REPLACE FUNCTION reject_direct_projection_write() RETURNS trigger AS $$
            BEGIN
                IF current_setting('app.projection_writer', true) IS DISTINCT FROM 'true' THEN
                    RAISE EXCEPTION
                        'Direct writes to % are not allowed; write through the projection framework.',
                        TG_TABLE_NAME
                        USING ERRCODE = 'insufficient_privilege';
                END IF;
                RETURN COALESCE(NEW, OLD);
            END;
            $$ LANGUAGE plpgsql
            """
        )
    )
    conn.execute(
        text(
            """
            CREATE TRIGGER trg_reject_direct_write_money_location_balance
            BEFORE INSERT OR UPDATE OR DELETE ON money_location_balance
            FOR EACH ROW EXECUTE FUNCTION reject_direct_projection_write()
            """
        )
    )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        text(
            "DROP TRIGGER IF EXISTS trg_reject_direct_write_money_location_balance "
            "ON money_location_balance"
        )
    )
    conn.execute(text("DROP FUNCTION IF EXISTS reject_direct_projection_write()"))
    for table_name in RLS_TABLES:
        conn.execute(text(f'DROP TABLE IF EXISTS "{table_name}" CASCADE'))
