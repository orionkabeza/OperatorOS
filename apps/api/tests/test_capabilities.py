"""The capability model (spec F.2): role bundles, per-user grant/revoke
layering, and location scoping. Tested directly against
resolve_effective_capabilities (unit-level) and once through the HTTP
surface via require_capability (test_cross_tenant_isolation.py and
test_auth.py already exercise the HTTP path for `user.manage`; this file
is about the *mechanism* being real, independent of which features
happen to exist yet).
"""

from __future__ import annotations

import pytest

from operatoros_api.capabilities import resolve_effective_capabilities
from operatoros_api.db import tenant_scoped_session
from operatoros_api.models.tenancy import UserGrant
from operatoros_api.seed import create_user
from tests.conftest import SeededTenant


@pytest.mark.asyncio
async def test_owner_role_bundle_has_every_capability(tenant_a: SeededTenant) -> None:
    async with tenant_scoped_session(tenant_a.business.id) as session:
        caps = await resolve_effective_capabilities(
            session,
            user_id=tenant_a.owner.id,
            role_key="owner",
            assigned_location_ids=[tenant_a.location.id],
        )
    assert caps.has("user.manage", None)
    assert caps.has("debt.write_off", None)
    assert caps.has("billing.manage", None)


@pytest.mark.asyncio
async def test_cashier_role_bundle_cannot_view_cost(tenant_a: SeededTenant) -> None:
    async with tenant_scoped_session(tenant_a.business.id) as session:
        cashier = await create_user(
            session,
            business_id=tenant_a.business.id,
            role=tenant_a.roles["cashier"],
            display_name="Cashier",
            secret="713245",
            phone="+250788000111",
            location_ids=[tenant_a.location.id],
        )
        caps = await resolve_effective_capabilities(
            session,
            user_id=cashier.id,
            role_key="cashier",
            assigned_location_ids=[tenant_a.location.id],
        )
    assert caps.has("sale.create", None)
    assert not caps.has("product.view_cost", None)
    assert not caps.has("user.manage", None)


@pytest.mark.asyncio
async def test_per_user_grant_adds_a_capability_the_role_does_not_have(
    tenant_a: SeededTenant,
) -> None:
    async with tenant_scoped_session(tenant_a.business.id) as session:
        session.add(
            UserGrant(
                business_id=tenant_a.business.id,
                user_id=tenant_a.owner.id,
                permission_key="product.view_cost",
                effect="grant",
                location_id=None,
            )
        )
        await session.flush()
        caps = await resolve_effective_capabilities(
            session,
            user_id=tenant_a.owner.id,
            role_key="cashier",
            assigned_location_ids=[tenant_a.location.id],
        )
    assert caps.has("product.view_cost", None)


@pytest.mark.asyncio
async def test_per_user_revoke_removes_a_capability_the_role_bundle_grants(
    tenant_a: SeededTenant,
) -> None:
    async with tenant_scoped_session(tenant_a.business.id) as session:
        session.add(
            UserGrant(
                business_id=tenant_a.business.id,
                user_id=tenant_a.owner.id,
                permission_key="debt.write_off",
                effect="revoke",
                location_id=None,
            )
        )
        await session.flush()
        caps = await resolve_effective_capabilities(
            session,
            user_id=tenant_a.owner.id,
            role_key="owner",
            assigned_location_ids=[tenant_a.location.id],
        )
    assert not caps.has("debt.write_off", None)
    # Everything else the Owner bundle grants is untouched.
    assert caps.has("user.manage", None)


@pytest.mark.asyncio
async def test_location_scoped_grant_only_applies_at_that_location(tenant_a: SeededTenant) -> None:
    other_location_id = "not-a-real-location-id"
    async with tenant_scoped_session(tenant_a.business.id) as session:
        storekeeper = await create_user(
            session,
            business_id=tenant_a.business.id,
            role=tenant_a.roles["storekeeper"],
            display_name="Storekeeper",
            secret="825190",
            phone="+250788000222",
            location_ids=[tenant_a.location.id],
        )
        session.add(
            UserGrant(
                business_id=tenant_a.business.id,
                user_id=storekeeper.id,
                permission_key="sale.create",
                effect="grant",
                location_id=tenant_a.location.id,
            )
        )
        await session.flush()
        caps = await resolve_effective_capabilities(
            session,
            user_id=storekeeper.id,
            role_key="storekeeper",
            assigned_location_ids=[tenant_a.location.id, other_location_id],
        )
    assert caps.has("sale.create", tenant_a.location.id)
    assert not caps.has("sale.create", other_location_id)
