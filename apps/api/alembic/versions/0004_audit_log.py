"""hash-chained audit log

Revision ID: 0004_audit_log
Revises: 0003_projections_and_idempotency
Create Date: 2026-08-20

`audit_log` (spec G.1 "Auditing"; approved plan §6): RLS-protected like
every other tenant table, but SELECT + INSERT only for operatoros_app --
no UPDATE, no DELETE. That's the privilege-level half of "append-only and
tamper-evident"; the hash chain (audit_log.py) is the other half, making
even a hypothetical direct-database edit (by a role that DOES have
UPDATE, e.g. during an incident response with elevated access) detectable
by re-walking the chain.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

revision: str = "0004_audit_log"
down_revision: str | None = "0003_projections_and_idempotency"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    from operatoros_api.models.audit_log import AuditLogEntry

    conn = op.get_bind()
    AuditLogEntry.metadata.create_all(bind=conn, tables=[AuditLogEntry.__table__])

    conn.execute(text('ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY'))
    conn.execute(text('ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY'))
    conn.execute(
        text(
            'CREATE POLICY tenant_isolation ON "audit_log" '
            "USING (business_id = current_setting('app.business_id', true)) "
            "WITH CHECK (business_id = current_setting('app.business_id', true))"
        )
    )
    conn.execute(text('GRANT SELECT, INSERT ON "audit_log" TO operatoros_app'))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(text('DROP TABLE IF EXISTS "audit_log" CASCADE'))
