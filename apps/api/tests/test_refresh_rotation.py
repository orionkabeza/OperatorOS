"""Refresh token rotation + reuse detection (spec G.1): "refresh-token
reuse detection revokes the entire token family." The test below does
exactly what the brief asks: uses a refresh token TWICE and asserts the
whole family is dead afterward (the original valid rotation's new token
included).
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.conftest import SeededTenant
from tests.helpers import login_as


@pytest.mark.asyncio
async def test_refresh_rotates_to_a_new_token(client: AsyncClient, tenant_a: SeededTenant) -> None:
    tokens = await login_as(client, tenant_a)
    resp = await client.post(
        "/api/v1/auth/refresh",
        json={"business_id": tenant_a.business.id, "refresh_token": tokens["refresh_token"]},
    )
    assert resp.status_code == 200, resp.text
    new_tokens = resp.json()
    assert new_tokens["refresh_token"] != tokens["refresh_token"]
    assert new_tokens["access_token"] != tokens["access_token"]


@pytest.mark.asyncio
async def test_reusing_a_refresh_token_revokes_the_whole_family(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    original = await login_as(client, tenant_a)

    first_refresh = await client.post(
        "/api/v1/auth/refresh",
        json={"business_id": tenant_a.business.id, "refresh_token": original["refresh_token"]},
    )
    assert first_refresh.status_code == 200
    rotated = first_refresh.json()

    # REUSE: present the already-consumed original token a second time.
    reuse_resp = await client.post(
        "/api/v1/auth/refresh",
        json={"business_id": tenant_a.business.id, "refresh_token": original["refresh_token"]},
    )
    assert reuse_resp.status_code == 401

    # The entire family is now dead -- including the token that was
    # legitimately issued by the FIRST (valid) rotation, not just the
    # reused one.
    follow_up_resp = await client.post(
        "/api/v1/auth/refresh",
        json={"business_id": tenant_a.business.id, "refresh_token": rotated["refresh_token"]},
    )
    assert follow_up_resp.status_code == 401


@pytest.mark.asyncio
async def test_refresh_with_unknown_token_is_rejected(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    resp = await client.post(
        "/api/v1/auth/refresh",
        json={"business_id": tenant_a.business.id, "refresh_token": "not-a-real-token"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_logout_revokes_the_refresh_token(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    tokens = await login_as(client, tenant_a)
    logout_resp = await client.post(
        "/api/v1/auth/logout",
        json={"business_id": tenant_a.business.id, "refresh_token": tokens["refresh_token"]},
    )
    assert logout_resp.status_code == 204

    refresh_resp = await client.post(
        "/api/v1/auth/refresh",
        json={"business_id": tenant_a.business.id, "refresh_token": tokens["refresh_token"]},
    )
    assert refresh_resp.status_code == 401
