from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.conftest import SeededTenant
from tests.helpers import auth_headers

pytestmark = pytest.mark.asyncio


async def test_me_returns_the_business_name(client: AsyncClient, tenant_a: SeededTenant) -> None:
    """The top bar names the shop on every screen, and no route returned that
    name. With nothing to render, the frontend shipped a hard-coded one from
    the mock fixtures -- so every real tenant in production saw a different
    shop's name above their own till."""
    headers = await auth_headers(client, tenant_a)
    resp = await client.get("/api/v1/users/me", headers=headers)

    assert resp.status_code == 200, resp.text
    assert resp.json()["business_name"] == tenant_a.business.name


async def test_me_names_the_caller_s_locations(client: AsyncClient, tenant_a: SeededTenant) -> None:
    """Nothing could turn a location id into a readable branch name:
    `GET /stock/locations` returns per-product stock rows, empty for a
    business with no products. The top bar printed a mock branch instead."""
    headers = await auth_headers(client, tenant_a)
    body = (await client.get("/api/v1/users/me", headers=headers)).json()

    assert body["locations"] == [{"id": tenant_a.location.id, "name": tenant_a.location.name}]
    # Same ids, same order, as the list every caller already resolves against.
    assert [loc["id"] for loc in body["locations"]] == body["location_ids"]


async def test_me_names_the_caller_s_own_business_only(
    client: AsyncClient, tenant_a: SeededTenant, tenant_b: SeededTenant
) -> None:
    """Naming the wrong tenant is the exact failure this field exists to end;
    it must not become a new way to do the same thing."""
    a_name = (
        await client.get("/api/v1/users/me", headers=await auth_headers(client, tenant_a))
    ).json()["business_name"]
    b_name = (
        await client.get("/api/v1/users/me", headers=await auth_headers(client, tenant_b))
    ).json()["business_name"]

    assert a_name == tenant_a.business.name
    assert b_name == tenant_b.business.name
    assert a_name != b_name
