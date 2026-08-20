"""Sign-in behaviour (spec D.1 / G.1): no user enumeration, lockout after
repeated failures, and the TOTP challenge/verify round trip.
"""

from __future__ import annotations

import uuid

import pyotp
import pytest
from httpx import AsyncClient

import operatoros_api.db as db_module
from operatoros_api.security.crypto import encrypt_secret
from operatoros_api.seed import create_user
from tests.conftest import SeededTenant


@pytest.mark.asyncio
async def test_unknown_identifier_and_wrong_secret_give_identical_response(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    device = f"device-{uuid.uuid4().hex[:8]}"

    unknown_resp = await client.post(
        "/api/v1/auth/login",
        json={
            "business_slug": tenant_a.business.slug,
            "identifier": "+250700000000",
            "secret": "000000",
            "device_id": device,
        },
    )
    wrong_secret_resp = await client.post(
        "/api/v1/auth/login",
        json={
            "business_slug": tenant_a.business.slug,
            "identifier": tenant_a.owner_phone,
            "secret": "999999",
            "device_id": f"device-{uuid.uuid4().hex[:8]}",
        },
    )

    assert unknown_resp.status_code == wrong_secret_resp.status_code == 401
    assert unknown_resp.json()["detail"] == wrong_secret_resp.json()["detail"]


@pytest.mark.asyncio
async def test_lockout_after_max_failed_attempts(client: AsyncClient, tenant_a: SeededTenant) -> None:
    device = f"device-{uuid.uuid4().hex[:8]}"
    body = {
        "business_slug": tenant_a.business.slug,
        "identifier": tenant_a.owner_phone,
        "secret": "wrong-secret",
        "device_id": device,
    }

    for _ in range(3):
        resp = await client.post("/api/v1/auth/login", json=body)
        assert resp.status_code == 401

    locked_resp = await client.post("/api/v1/auth/login", json=body)
    assert locked_resp.status_code == 423

    # Even the CORRECT secret is refused once the device is locked.
    good_body = {**body, "secret": tenant_a.owner_secret}
    still_locked = await client.post("/api/v1/auth/login", json=good_body)
    assert still_locked.status_code == 423


@pytest.mark.asyncio
async def test_login_from_a_different_device_is_not_affected_by_another_devices_lockout(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    locked_device = f"device-{uuid.uuid4().hex[:8]}"
    other_device = f"device-{uuid.uuid4().hex[:8]}"
    bad_body = {
        "business_slug": tenant_a.business.slug,
        "identifier": tenant_a.owner_phone,
        "secret": "wrong-secret",
        "device_id": locked_device,
    }
    for _ in range(4):
        await client.post("/api/v1/auth/login", json=bad_body)

    resp = await client.post(
        "/api/v1/auth/login",
        json={
            "business_slug": tenant_a.business.slug,
            "identifier": tenant_a.owner_phone,
            "secret": tenant_a.owner_secret,
            "device_id": other_device,
        },
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_totp_challenge_then_verify_issues_real_tokens(
    client: AsyncClient, tenant_a: SeededTenant, postgres_urls: dict[str, str]
) -> None:
    raw_totp_secret = pyotp.random_base32()
    async with db_module.tenant_scoped_session(tenant_a.business.id) as session:
        totp_user = await create_user(
            session,
            business_id=tenant_a.business.id,
            role=tenant_a.roles["manager"],
            display_name="2FA Manager",
            secret="611234",
            phone="+250788112233",
            location_ids=[tenant_a.location.id],
            totp_enabled=True,
            totp_secret_encrypted=encrypt_secret(raw_totp_secret),
        )
        totp_user_id = totp_user.id

    login_resp = await client.post(
        "/api/v1/auth/login",
        json={
            "business_slug": tenant_a.business.slug,
            "identifier": "+250788112233",
            "secret": "611234",
            "device_id": f"device-{uuid.uuid4().hex[:8]}",
        },
    )
    assert login_resp.status_code == 200
    body = login_resp.json()
    assert body["totp_required"] is True
    assert not body["access_token"]
    challenge_token = body["challenge_token"]
    assert challenge_token

    wrong_code_resp = await client.post(
        "/api/v1/auth/totp/verify", json={"challenge_token": challenge_token, "code": "000000"}
    )
    assert wrong_code_resp.status_code == 401

    code = pyotp.TOTP(raw_totp_secret).now()
    verify_resp = await client.post(
        "/api/v1/auth/totp/verify", json={"challenge_token": challenge_token, "code": code}
    )
    assert verify_resp.status_code == 200, verify_resp.text
    tokens = verify_resp.json()
    assert tokens["access_token"]
    assert tokens["totp_required"] is False

    me_resp = await client.get(
        "/api/v1/users/me", headers={"Authorization": f"Bearer {tokens['access_token']}"}
    )
    assert me_resp.status_code == 200
    assert me_resp.json()["id"] == totp_user_id


@pytest.mark.asyncio
async def test_request_bodies_reject_unknown_fields(client: AsyncClient, tenant_a: SeededTenant) -> None:
    resp = await client.post(
        "/api/v1/auth/login",
        json={
            "business_slug": tenant_a.business.slug,
            "identifier": tenant_a.owner_phone,
            "secret": tenant_a.owner_secret,
            "device_id": "d1",
            "not_a_real_field": "haha",
        },
    )
    assert resp.status_code == 422
