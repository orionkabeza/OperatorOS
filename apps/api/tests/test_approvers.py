from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.conftest import SeededTenant
from tests.helpers import auth_headers

pytestmark = pytest.mark.asyncio


async def test_lists_users_holding_the_requested_capability(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    resp = await client.get(
        "/api/v1/users/approvers",
        params={"capability": "sale.discount.over_threshold"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    approvers = resp.json()
    # The seeded owner holds every capability.
    assert len(approvers) >= 1
    assert all(set(a.keys()) == {"id", "display_name"} for a in approvers)


async def test_never_leaks_contact_details(client: AsyncClient, tenant_a: SeededTenant) -> None:
    """A cashier needs a name to pick, not a colleague's phone or email."""
    headers = await auth_headers(client, tenant_a)
    resp = await client.get(
        "/api/v1/users/approvers",
        params={"capability": "sale.discount.over_threshold"},
        headers=headers,
    )
    body = resp.text
    assert "phone" not in body
    assert "email" not in body
    assert "role_key" not in body


async def test_rejects_an_unknown_capability(client: AsyncClient, tenant_a: SeededTenant) -> None:
    """Stops the endpoint being used to probe for arbitrary strings."""
    headers = await auth_headers(client, tenant_a)
    resp = await client.get(
        "/api/v1/users/approvers", params={"capability": "not.a.capability"}, headers=headers
    )
    assert resp.status_code == 422


async def test_requires_authentication(client: AsyncClient) -> None:
    resp = await client.get(
        "/api/v1/users/approvers", params={"capability": "sale.discount.over_threshold"}
    )
    assert resp.status_code == 401


async def test_does_not_leak_across_tenants(
    client: AsyncClient, tenant_a: SeededTenant, tenant_b: SeededTenant
) -> None:
    """RLS must scope this the same as every other tenant-owned read."""
    headers = await auth_headers(client, tenant_a)
    resp = await client.get(
        "/api/v1/users/approvers",
        params={"capability": "sale.discount.over_threshold"},
        headers=headers,
    )
    ids = {a["id"] for a in resp.json()}

    other_headers = await auth_headers(client, tenant_b)
    other_resp = await client.get(
        "/api/v1/users/approvers",
        params={"capability": "sale.discount.over_threshold"},
        headers=other_headers,
    )
    other_ids = {a["id"] for a in other_resp.json()}

    assert ids and other_ids
    assert ids.isdisjoint(other_ids)
