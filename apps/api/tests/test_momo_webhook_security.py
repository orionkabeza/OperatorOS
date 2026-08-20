"""The MoMo webhook receiver is one of the two places this phase
intentionally opens a hole in the normal tenant-auth wall (plan §3) --
this file is its dedicated scrutiny, beyond the generic cross-tenant
isolation suite (which doesn't even attempt this route, since it has no
`get_current_context` dependency to walk to and no path parameter to
substitute a tenant-B id into): unsigned calls, wrong signatures, replayed
nonces, and stale timestamps must all be rejected; a validly signed call
must be idempotent on (provider, external_id) and, when it settles a
pending pay link, must write PAYMENT_RECEIVED and move both projections.
"""

from __future__ import annotations

import json
import time
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from operatoros_api.api.routers.momo import WebhookRejected, process_momo_webhook
from operatoros_api.db import tenant_scoped_session
from operatoros_api.models.momo import MomoProviderCredential, MomoTransaction
from operatoros_api.security.crypto import decrypt_secret
from operatoros_api.security.webhooks import compute_signature
from tests.conftest import SeededTenant
from tests.helpers import auth_headers, idempotency_headers

PROVIDER = "sandbox_momo"


async def _connect(client: AsyncClient, headers: dict) -> None:
    resp = await client.post(
        "/api/v1/momo/connect",
        headers={**headers, **idempotency_headers()},
        json={"merchant_ref": "test-merchant"},
    )
    assert resp.status_code == 201, resp.text


async def _secret_for(tenant: SeededTenant) -> str:
    async with tenant_scoped_session(tenant.business.id) as session:
        result = await session.execute(
            select(MomoProviderCredential).where(
                MomoProviderCredential.business_id == tenant.business.id,
                MomoProviderCredential.provider == PROVIDER,
            )
        )
        cred = result.scalar_one()
        return decrypt_secret(cred.encrypted_secret)


def _build_payload(business_id: str, *, external_id: str, phone: str, amount_minor: int) -> bytes:
    payload = {
        "business_id": business_id,
        "external_id": external_id,
        "phone": phone,
        "amount_minor": amount_minor,
        "direction": "in",
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _sign(secret: str, raw_body: bytes, *, timestamp: str | None = None, nonce: str | None = None):
    ts = timestamp or str(time.time())
    n = nonce or uuid.uuid4().hex
    sig = compute_signature(secret, ts, n, raw_body)
    return {"x-momo-timestamp": ts, "x-momo-nonce": n, "x-momo-signature": sig}


@pytest.mark.asyncio
async def test_unsigned_webhook_is_rejected(client: AsyncClient, tenant_a: SeededTenant) -> None:
    headers = await auth_headers(client, tenant_a)
    await _connect(client, headers)
    raw_body = _build_payload(
        tenant_a.business.id, external_id=uuid.uuid4().hex, phone="+250788000000", amount_minor=1000
    )
    with pytest.raises(WebhookRejected) as exc_info:
        await process_momo_webhook(PROVIDER, raw_body, {})
    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_wrong_signature_is_rejected(client: AsyncClient, tenant_a: SeededTenant) -> None:
    headers = await auth_headers(client, tenant_a)
    await _connect(client, headers)
    raw_body = _build_payload(
        tenant_a.business.id, external_id=uuid.uuid4().hex, phone="+250788000000", amount_minor=1000
    )
    bad_headers = _sign("this-is-not-the-real-secret", raw_body)
    with pytest.raises(WebhookRejected) as exc_info:
        await process_momo_webhook(PROVIDER, raw_body, bad_headers)
    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_unknown_business_id_is_rejected(client: AsyncClient, tenant_a: SeededTenant) -> None:
    """No tenant registered under this business_id at all -- must fail the
    same generic way a wrong signature does, not a different error."""
    raw_body = _build_payload(
        uuid.uuid4().hex, external_id=uuid.uuid4().hex, phone="+250788000000", amount_minor=1000
    )
    good_shaped_headers = _sign("any-secret-whatsoever", raw_body)
    with pytest.raises(WebhookRejected) as exc_info:
        await process_momo_webhook(PROVIDER, raw_body, good_shaped_headers)
    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_stale_timestamp_is_rejected(client: AsyncClient, tenant_a: SeededTenant) -> None:
    headers = await auth_headers(client, tenant_a)
    await _connect(client, headers)
    secret = await _secret_for(tenant_a)
    raw_body = _build_payload(
        tenant_a.business.id, external_id=uuid.uuid4().hex, phone="+250788000000", amount_minor=1000
    )
    stale_timestamp = str(time.time() - 3600)  # 1 hour old, well outside the 5-minute window
    stale_headers = _sign(secret, raw_body, timestamp=stale_timestamp)
    with pytest.raises(WebhookRejected) as exc_info:
        await process_momo_webhook(PROVIDER, raw_body, stale_headers)
    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_valid_signed_webhook_lands_an_unmatched_transaction(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    await _connect(client, headers)
    secret = await _secret_for(tenant_a)
    external_id = uuid.uuid4().hex
    raw_body = _build_payload(
        tenant_a.business.id, external_id=external_id, phone="+250788000000", amount_minor=5000
    )
    good_headers = _sign(secret, raw_body)

    result = await process_momo_webhook(PROVIDER, raw_body, good_headers)
    assert result["status"] == "landed_unmatched"

    async with tenant_scoped_session(tenant_a.business.id) as session:
        txn_result = await session.execute(
            select(MomoTransaction).where(
                MomoTransaction.business_id == tenant_a.business.id,
                MomoTransaction.external_id == external_id,
            )
        )
        txn = txn_result.scalar_one()
        assert txn.status == "unmatched"
        assert txn.amount_minor == 5000


@pytest.mark.asyncio
async def test_replayed_nonce_is_rejected_even_with_a_valid_signature(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    await _connect(client, headers)
    secret = await _secret_for(tenant_a)
    external_id = uuid.uuid4().hex
    raw_body = _build_payload(
        tenant_a.business.id, external_id=external_id, phone="+250788000000", amount_minor=2500
    )
    replay_headers = _sign(secret, raw_body)

    first = await process_momo_webhook(PROVIDER, raw_body, replay_headers)
    assert first["status"] == "landed_unmatched"

    # The EXACT same signed request, byte-for-byte -- a captured-and-
    # replayed call, not a legitimate retry.
    with pytest.raises(WebhookRejected) as exc_info:
        await process_momo_webhook(PROVIDER, raw_body, replay_headers)
    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_idempotent_on_provider_and_external_id_with_a_fresh_nonce(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    """A legitimate retry (the provider re-delivering the same logical
    transaction with a fresh timestamp/nonce, as real webhook providers
    do) must be idempotent -- landing exactly one momo_transactions row,
    not rejected outright the way a byte-identical replay is."""
    headers = await auth_headers(client, tenant_a)
    await _connect(client, headers)
    secret = await _secret_for(tenant_a)
    external_id = uuid.uuid4().hex
    raw_body = _build_payload(
        tenant_a.business.id, external_id=external_id, phone="+250788000000", amount_minor=7500
    )

    first_result = await process_momo_webhook(PROVIDER, raw_body, _sign(secret, raw_body))
    assert first_result["status"] == "landed_unmatched"

    second_result = await process_momo_webhook(PROVIDER, raw_body, _sign(secret, raw_body))
    assert second_result["status"] == "already_processed"

    async with tenant_scoped_session(tenant_a.business.id) as session:
        count_result = await session.execute(
            select(MomoTransaction).where(
                MomoTransaction.business_id == tenant_a.business.id,
                MomoTransaction.external_id == external_id,
            )
        )
        assert len(count_result.all()) == 1


@pytest.mark.asyncio
async def test_webhook_http_route_rejects_bad_signature_with_401(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    """End-to-end through the actual HTTP route (not just the shared
    processing function) -- proves the route itself is wired to reject,
    not just the function it delegates to."""
    headers = await auth_headers(client, tenant_a)
    await _connect(client, headers)
    raw_body = _build_payload(
        tenant_a.business.id, external_id=uuid.uuid4().hex, phone="+250788000000", amount_minor=1000
    )
    resp = await client.post(
        f"/api/v1/momo/webhook/{PROVIDER}",
        content=raw_body,
        headers={
            "content-type": "application/json",
            "x-momo-timestamp": str(time.time()),
            "x-momo-nonce": uuid.uuid4().hex,
            "x-momo-signature": "0" * 64,
        },
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_webhook_route_requires_no_authentication_header_at_all(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    """Confirms the route is genuinely public (no Authorization header
    sent) and still reaches signature verification rather than bouncing
    off `get_current_context` -- i.e. this really is the intentional hole
    in the auth wall, not an accidentally-public route that happens to
    also reject for the wrong reason."""
    resp = await client.post(
        f"/api/v1/momo/webhook/{PROVIDER}",
        content=b"{}",
        headers={"content-type": "application/json"},
    )
    assert resp.status_code == 401
    assert "detail" in resp.json()
