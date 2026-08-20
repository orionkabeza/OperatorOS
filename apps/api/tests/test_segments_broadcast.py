"""Customer segments and broadcast (spec D.6.8): live segment membership
and a broadcast send snapshotting who was actually targeted.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient

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


@pytest.mark.asyncio
async def test_segment_membership_and_broadcast_recipient_count(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    await _open_day(client, headers, tenant_a)

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
    product_id = product_resp.json()["id"]
    await client.post(
        "/api/v1/stock/receive",
        headers={**headers, **idempotency_headers()},
        json={
            "product_id": product_id,
            "location_id": tenant_a.location.id,
            "quantity": "5.0000",
            "unit_cost_minor": 50000,
        },
    )
    customer_resp = await client.post(
        "/api/v1/customers",
        headers={**headers, **idempotency_headers()},
        json={"name": "Segment Customer", "phone": f"+2507{uuid.uuid4().int % 10**8:08d}"},
    )
    customer_id = customer_resp.json()["id"]
    sale_resp = await client.post(
        "/api/v1/sales",
        headers={**headers, **idempotency_headers()},
        json={
            "location_id": tenant_a.location.id,
            "customer_id": customer_id,
            "lines": [{"product_id": product_id, "quantity": "1.0000"}],
            "payments": [{"method": "cash", "amount_minor": 118000}],
        },
    )
    assert sale_resp.status_code == 201, sale_resp.text

    segment_resp = await client.post(
        "/api/v1/customers/segments",
        headers={**headers, **idempotency_headers()},
        json={
            "name": "Bought in the last 30 days",
            "filter_spec": {"kind": "bought_in_last_days", "days": 30},
        },
    )
    assert segment_resp.status_code == 201, segment_resp.text
    segment = segment_resp.json()
    assert segment["member_count"] >= 1

    list_resp = await client.get("/api/v1/customers/segments", headers=headers)
    assert any(s["id"] == segment["id"] for s in list_resp.json())

    broadcast_resp = await client.post(
        "/api/v1/customers/broadcast",
        headers={**headers, **idempotency_headers()},
        json={"segment_id": segment["id"], "message": "New stock has arrived!"},
    )
    assert broadcast_resp.status_code == 201, broadcast_resp.text
    body = broadcast_resp.json()
    assert body["recipient_count"] >= 1
    assert body["delivered_count"] == body["recipient_count"]


@pytest.mark.asyncio
async def test_top_n_by_spend_and_inactive_segment_kinds_compute(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)

    top_resp = await client.post(
        "/api/v1/customers/segments",
        headers={**headers, **idempotency_headers()},
        json={"name": "Top 5 by spend", "filter_spec": {"kind": "top_n_by_spend", "n": 5}},
    )
    assert top_resp.status_code == 201, top_resp.text

    inactive_resp = await client.post(
        "/api/v1/customers/segments",
        headers={**headers, **idempotency_headers()},
        json={
            "name": "Haven't been back in 60 days",
            "filter_spec": {"kind": "inactive_since_days", "days": 60},
        },
    )
    assert inactive_resp.status_code == 201, inactive_resp.text
