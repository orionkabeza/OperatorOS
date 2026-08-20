"""Direct, table-level proof that RLS (not application WHERE clauses) is
what stops cross-tenant reads and writes. spec G.1 calls this out
explicitly: "the tenant id derives from the verified session... An
automated test suite attempts cross-tenant access... and fails the build
if any succeeds." test_cross_tenant_isolation.py does that through the
HTTP surface; this file does it one layer down, straight through
tenant_scoped_session, so a bug in a future route handler that forgets to
even use the dependency chain still can't leak data -- RLS is the actual
backstop, not a well-behaved caller.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError

import operatoros_api.db as db_module
from operatoros_api.models.tenancy import Location
from tests.conftest import SeededTenant


@pytest.mark.asyncio
async def test_rls_scopes_select_to_the_active_tenant(
    tenant_a: SeededTenant, tenant_b: SeededTenant
) -> None:
    async with db_module.tenant_scoped_session(tenant_a.business.id) as session:
        result = await session.execute(select(Location))
        ids = {row.id for row in result.scalars()}
    assert tenant_a.location.id in ids
    assert tenant_b.location.id not in ids


@pytest.mark.asyncio
async def test_rls_get_by_id_returns_nothing_for_another_tenants_row(
    tenant_a: SeededTenant, tenant_b: SeededTenant
) -> None:
    async with db_module.tenant_scoped_session(tenant_a.business.id) as session:
        row = await session.get(Location, tenant_b.location.id)
    assert row is None


@pytest.mark.asyncio
async def test_rls_forces_deny_by_default_with_no_tenant_guc_set(tenant_a: SeededTenant) -> None:
    """FORCE ROW LEVEL SECURITY means even a query issued with no
    app.business_id set at all sees zero rows, not "everything" -- the
    failure mode of a forgotten WHERE clause is silence, not a leak."""
    async with db_module.tenant_scoped_session(None) as session:
        result = await session.execute(select(Location))
        rows = result.scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_rls_with_check_blocks_writing_a_row_tagged_for_another_tenant(
    tenant_a: SeededTenant, tenant_b: SeededTenant
) -> None:
    """Even if application code carelessly set business_id from something
    other than the verified tenant while the session was scoped to tenant
    A, the policy's WITH CHECK clause rejects the write outright."""
    async with db_module.tenant_scoped_session(tenant_a.business.id) as session:
        sneaky = Location(business_id=tenant_b.business.id, name="should never land")
        session.add(sneaky)
        with pytest.raises(DBAPIError):
            await session.flush()
