from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.conftest import SeededTenant
from tests.helpers import login_as


@pytest.mark.asyncio
async def test_health(client: AsyncClient) -> None:
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_login_success(client: AsyncClient, tenant_a: SeededTenant) -> None:
    tokens = await login_as(client, tenant_a)
    assert tokens["access_token"]
    assert tokens["refresh_token"]
    assert tokens["totp_required"] is False


@pytest.mark.asyncio
async def test_me_after_login(client: AsyncClient, tenant_a: SeededTenant) -> None:
    tokens = await login_as(client, tenant_a)
    resp = await client.get(
        "/api/v1/users/me", headers={"Authorization": f"Bearer {tokens['access_token']}"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["business_id"] == tenant_a.business.id
    assert body["role_key"] == "owner"
