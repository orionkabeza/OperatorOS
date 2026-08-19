"""tenancy schema + row level security

Revision ID: 0001_tenancy_and_rls
Revises:
Create Date: 2026-08-19

Creates the tenancy/auth tables (spec E.4 subset) and, for every one of
them except `businesses`, enables + forces Postgres Row Level Security
bound to the `app.business_id` session GUC (spec E.4/G.1). This is the
single most important migration in Phase 0.

Role bootstrap (`operatoros_admin`, the migration-owning role, and
`operatoros_app`, the non-superuser/non-BYPASSRLS role the API connects
as) happens OUTSIDE Alembic -- roles are cluster-level objects, not
per-database schema, so they're created once by
`infra/postgres/init/01-roles.sql` (docker-compose's postgres image runs
everything in docker-entrypoint-initdb.d on first boot) or, for tests, by
the pgserver fixture in tests/conftest.py. This migration assumes both
roles already exist and only GRANTs privileges to `operatoros_app`.

Tables are created via `Base.metadata.create_all(..., tables=[...])`
against the actual ORM model `Table` objects rather than hand-duplicated
`op.create_table(...)` calls, specifically so the migration can never
drift out of sync with `operatoros_api/models/tenancy.py` — see
docs/DECISIONS.md.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

revision: str = "0001_tenancy_and_rls"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every table here gets business_id-bound RLS. `businesses` is
# deliberately excluded -- see models/tenancy.py module docstring and
# docs/DECISIONS.md.
TENANT_TABLES = [
    "locations",
    "roles",
    "permissions",
    "role_permissions",
    "users",
    "user_locations",
    "user_grants",
    "device_sessions",
    "refresh_tokens",
    "login_attempts",
]


def upgrade() -> None:
    from operatoros_api.models.tenancy import (
        Business,
        DeviceSession,
        Location,
        LoginAttempt,
        Permission,
        RefreshToken,
        Role,
        RolePermission,
        User,
        UserGrant,
        UserLocation,
    )

    conn = op.get_bind()
    tables = [
        Business.__table__,
        Location.__table__,
        Role.__table__,
        Permission.__table__,
        RolePermission.__table__,
        User.__table__,
        UserLocation.__table__,
        UserGrant.__table__,
        DeviceSession.__table__,
        RefreshToken.__table__,
        LoginAttempt.__table__,
    ]
    Business.metadata.create_all(bind=conn, tables=tables)

    for table_name in TENANT_TABLES:
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
            text(
                f'GRANT SELECT, INSERT, UPDATE, DELETE ON "{table_name}" TO operatoros_app'
            )
        )

    # businesses: no RLS (tenant root, not tenant-owned data -- see module
    # docstring). operatoros_app gets SELECT (pre-auth slug resolution,
    # tenancy_resolution.py), INSERT (signup/onboarding creates a new
    # tenant root -- a later phase's feature, but the schema/grant needs to
    # allow it now), and UPDATE (a business editing its own profile). No
    # DELETE: a business is suspended via `status`, never hard-deleted,
    # consistent with the ledger's own no-deletes principle. Cross-business
    # UPDATE safety (row X can only update row X) is an application-layer
    # concern here, same as it would be for any single-row-by-id update --
    # RLS isn't the mechanism for this one table by design (see module
    # docstring), so the app layer must always filter by the caller's own
    # resolved business id.
    conn.execute(text('GRANT SELECT, INSERT, UPDATE ON "businesses" TO operatoros_app'))


def downgrade() -> None:
    conn = op.get_bind()
    for table_name in reversed(TENANT_TABLES):
        conn.execute(text(f'DROP POLICY IF EXISTS tenant_isolation ON "{table_name}"'))
    for table_name in [*reversed(TENANT_TABLES), "businesses"]:
        conn.execute(text(f'DROP TABLE IF EXISTS "{table_name}" CASCADE'))
