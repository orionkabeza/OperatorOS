from __future__ import annotations

import uuid

from httpx import AsyncClient

from tests.conftest import SeededTenant


async def login_as(client: AsyncClient, tenant: SeededTenant, device_id: str | None = None) -> dict:
    resp = await client.post(
        "/api/v1/auth/login",
        json={
            "business_slug": tenant.business.slug,
            "identifier": tenant.owner_phone,
            "secret": tenant.owner_secret,
            "device_id": device_id or f"device-{uuid.uuid4().hex[:8]}",
        },
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def auth_headers(client: AsyncClient, tenant: SeededTenant, device_id: str | None = None) -> dict:
    tokens = await login_as(client, tenant, device_id)
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def idempotency_headers(key: str | None = None) -> dict:
    return {"Idempotency-Key": key or f"idem-{uuid.uuid4().hex}"}
