"""`/pay/{token}` is the second of the two places this phase intentionally
opens a hole in the normal tenant-auth wall (plan §0.5) -- dedicated
scrutiny beyond the generic cross-tenant isolation suite, which doesn't
attempt this route at all (no `get_current_context` dependency, no path
parameter shaped like the resources that suite knows how to seed).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from httpx import AsyncClient
from sqlalchemy import select

from operatoros_api.config import get_settings
from operatoros_api.db import tenant_scoped_session
from operatoros_api.models.customers import CustomerBalance
from operatoros_api.models.paylink import PayLink
from tests.conftest import SeededTenant
from tests.helpers import auth_headers, idempotency_headers


async def _open_day(client: AsyncClient, headers: dict, tenant: SeededTenant) -> None:
    status_resp = await client.get(
        "/api/v1/day/status", headers=headers, params={"location_id": tenant.location.id}
    )
    if status_resp.json() is not None:
        return
    resp = await client.post(
        "/api/v1/day/open",
        headers={**headers, **idempotency_headers()},
        json={"location_id": tenant.location.id, "counted_amount_minor": 0},
    )
    assert resp.status_code == 201, resp.text


async def _create_product(client: AsyncClient, headers: dict) -> str:
    unit_resp = await client.post(
        "/api/v1/products/units",
        headers={**headers, **idempotency_headers()},
        json={"name": f"unit-{uuid.uuid4().hex[:6]}", "symbol": "pc"},
    )
    unit_id = unit_resp.json()["id"]
    product_resp = await client.post(
        "/api/v1/products",
        headers={**headers, **idempotency_headers()},
        json={
            "name": f"Item {uuid.uuid4().hex[:6]}",
            "base_unit_id": unit_id,
            "cost_price_minor": 50000,
            "selling_price_minor": 100000,
        },
    )
    assert product_resp.status_code == 201, product_resp.text
    return product_resp.json()["id"]


async def _setup_customer_with_debt(
    client: AsyncClient, headers: dict, tenant: SeededTenant
) -> str:
    await _open_day(client, headers, tenant)
    product_id = await _create_product(client, headers)
    await client.post(
        "/api/v1/stock/receive",
        headers={**headers, **idempotency_headers()},
        json={
            "product_id": product_id,
            "location_id": tenant.location.id,
            "quantity": "5.0000",
            "unit_cost_minor": 50000,
        },
    )
    customer_resp = await client.post(
        "/api/v1/customers",
        headers={**headers, **idempotency_headers()},
        json={"name": "Pay Link Customer", "phone": f"+2507{uuid.uuid4().int % 10**8:08d}"},
    )
    customer_id = customer_resp.json()["id"]
    await client.post(
        f"/api/v1/customers/{customer_id}/credit-limit",
        headers={**headers, **idempotency_headers()},
        json={"new_limit_minor": 10_000_000},
    )
    sale_resp = await client.post(
        "/api/v1/sales",
        headers={**headers, **idempotency_headers()},
        json={
            "location_id": tenant.location.id,
            "customer_id": customer_id,
            "lines": [{"product_id": product_id, "quantity": "1.0000"}],
            "payments": [{"method": "credit", "amount_minor": 118000}],
        },
    )
    assert sale_resp.status_code == 201, sale_resp.text
    return customer_id


async def _create_pay_link(
    client: AsyncClient, headers: dict, tenant: SeededTenant, customer_id: str
) -> str:
    resp = await client.post(
        f"/api/v1/debt/accounts/{customer_id}/pay-link",
        headers={**headers, **idempotency_headers()},
        json={"location_id": tenant.location.id},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["token"]


@pytest.mark.asyncio
async def test_valid_pay_link_returns_the_correct_amount_and_names(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    customer_id = await _setup_customer_with_debt(client, headers, tenant_a)
    token = await _create_pay_link(client, headers, tenant_a, customer_id)

    resp = await client.get(f"/pay/{token}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["amount_minor"] == 118000
    assert body["status"] == "pending"
    assert body["business_name"] == tenant_a.business.name


@pytest.mark.asyncio
async def test_pay_link_requires_no_authentication_header(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    customer_id = await _setup_customer_with_debt(client, headers, tenant_a)
    token = await _create_pay_link(client, headers, tenant_a, customer_id)

    # No Authorization header at all -- genuinely public.
    resp = await client.get(f"/pay/{token}")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_garbage_token_is_rejected(client: AsyncClient) -> None:
    resp = await client.get("/pay/not-a-real-token-at-all")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_tampered_token_is_rejected(client: AsyncClient, tenant_a: SeededTenant) -> None:
    """A JWT with a business_id swapped in but re-signed with the WRONG
    key (i.e. not actually possessing operatoros_api's signing secret)
    must fail signature verification -- proving business_id alone isn't
    enough, the signature is the actual boundary."""
    forged = jwt.encode(
        {
            "pay_link_id": str(uuid.uuid4()),
            "business_id": tenant_a.business.id,
            "type": "pay_link",
            "exp": int((datetime.now(UTC) + timedelta(days=7)).timestamp()),
        },
        "attacker-does-not-know-the-real-secret",
        algorithm="HS256",
    )
    resp = await client.get(f"/pay/{forged}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_expired_token_is_rejected(client: AsyncClient, tenant_a: SeededTenant) -> None:
    headers = await auth_headers(client, tenant_a)
    customer_id = await _setup_customer_with_debt(client, headers, tenant_a)

    async with tenant_scoped_session(tenant_a.business.id) as session:
        pay_link = PayLink(
            business_id=tenant_a.business.id,
            location_id=tenant_a.location.id,
            customer_id=customer_id,
            amount_minor=1000,
            expires_at=datetime.now(UTC) - timedelta(days=1),
            status="pending",
        )
        session.add(pay_link)
        await session.flush()
        settings = get_settings()
        already_expired_token = jwt.encode(
            {
                "pay_link_id": pay_link.id,
                "business_id": tenant_a.business.id,
                "type": "pay_link",
                "exp": int((datetime.now(UTC) - timedelta(minutes=1)).timestamp()),
            },
            settings.jwt_secret,
            algorithm=settings.jwt_algorithm,
        )

    resp = await client.get(f"/pay/{already_expired_token}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_a_wrong_business_id_claim_paired_with_another_tenants_real_link_is_rejected(
    client: AsyncClient, tenant_a: SeededTenant, tenant_b: SeededTenant
) -> None:
    """Even a structurally valid, correctly-signed token naming the WRONG
    business_id for a given pay_link_id must fail -- create a real pay
    link for tenant A, then forge a token claiming it belongs to tenant B
    (still signed with the real, known-to-the-server secret, since an
    attacker able to forge arbitrary claims would need the server's own
    key -- this specifically tests the `pay_link.business_id !=
    claims.business_id` cross-check in `pay.py::_resolve_live_pay_link`,
    which matters even with a legitimately-signed token if a bug ever let
    two different tenants collide on the same id space)."""
    headers = await auth_headers(client, tenant_a)
    customer_id = await _setup_customer_with_debt(client, headers, tenant_a)

    async with tenant_scoped_session(tenant_a.business.id) as session:
        pay_link = PayLink(
            business_id=tenant_a.business.id,
            location_id=tenant_a.location.id,
            customer_id=customer_id,
            amount_minor=1000,
            expires_at=datetime.now(UTC) + timedelta(days=7),
            status="pending",
        )
        session.add(pay_link)
        await session.flush()
        pay_link_id = pay_link.id

    settings = get_settings()
    mismatched_token = jwt.encode(
        {
            "pay_link_id": pay_link_id,
            "business_id": tenant_b.business.id,
            "type": "pay_link",
            "exp": int((datetime.now(UTC) + timedelta(days=7)).timestamp()),
        },
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    resp = await client.get(f"/pay/{mismatched_token}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_paid_link_cannot_be_reused_even_with_a_still_valid_token(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    customer_id = await _setup_customer_with_debt(client, headers, tenant_a)
    token = await _create_pay_link(client, headers, tenant_a, customer_id)

    resp = await client.get(f"/pay/{token}")
    assert resp.status_code == 200

    # Mark it paid directly (simulating a completed settlement) -- the
    # token itself is still cryptographically valid and unexpired.
    async with tenant_scoped_session(tenant_a.business.id) as session:
        balance_result = await session.execute(
            select(CustomerBalance).where(CustomerBalance.customer_id == customer_id)
        )
        _ = balance_result.scalar_one_or_none()
        pay_link_result = await session.execute(
            select(PayLink).where(PayLink.business_id == tenant_a.business.id)
        )
        pay_link = pay_link_result.scalars().first()
        pay_link.status = "paid"
        pay_link.paid_at = datetime.now(UTC)
        await session.flush()

    resp_after = await client.get(f"/pay/{token}")
    assert resp_after.status_code == 404, "a paid link's token must stop working"
