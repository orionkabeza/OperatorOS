"""Debt Book read surfaces: header band ageing, the accounts table's
status chips, and the "who to chase today" queue (spec D.6.1/D.6.2/D.6.7).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient

from operatoros_api.db import tenant_scoped_session
from operatoros_api.models.sales import Sale
from tests.conftest import SeededTenant
from tests.helpers import auth_headers, idempotency_headers


async def _open_day(client: AsyncClient, headers: dict, tenant: SeededTenant) -> None:
    status_resp = await client.get(
        "/api/v1/day/status", headers=headers, params={"location_id": tenant.location.id}
    )
    assert status_resp.status_code == 200, status_resp.text
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


async def _create_customer(client: AsyncClient, headers: dict, *, terms_days: int) -> str:
    resp = await client.post(
        "/api/v1/customers",
        headers={**headers, **idempotency_headers()},
        json={
            "name": f"Customer {uuid.uuid4().hex[:6]}",
            "phone": f"+2507{uuid.uuid4().int % 10**8:08d}",
            "terms_days": terms_days,
        },
    )
    assert resp.status_code == 201, resp.text
    customer_id = resp.json()["id"]
    limit_resp = await client.post(
        f"/api/v1/customers/{customer_id}/credit-limit",
        headers={**headers, **idempotency_headers()},
        json={"new_limit_minor": 10_000_000},
    )
    assert limit_resp.status_code == 200, limit_resp.text
    return customer_id


@pytest.mark.asyncio
async def test_overdue_invoice_appears_in_header_ageing_and_chase_queue(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    await _open_day(client, headers, tenant_a)
    product_id = await _create_product(client, headers)

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

    # terms_days=0 -> due date is "now", so a moment later this invoice is
    # already overdue by construction.
    customer_id = await _create_customer(client, headers, terms_days=0)
    sale_resp = await client.post(
        "/api/v1/sales",
        headers={**headers, **idempotency_headers()},
        json={
            "location_id": tenant_a.location.id,
            "customer_id": customer_id,
            "lines": [{"product_id": product_id, "quantity": "1.0000"}],
            "payments": [{"method": "credit", "amount_minor": 118000}],
        },
    )
    assert sale_resp.status_code == 201, sale_resp.text
    sale_id = sale_resp.json()["id"]

    # Force the due date solidly into the past so ageing/overdue math is
    # unambiguous regardless of test execution speed.
    async with tenant_scoped_session(tenant_a.business.id) as session:
        sale = await session.get(Sale, sale_id)
        assert sale is not None
        sale.due_date_at = datetime.now(UTC) - timedelta(days=45)
        await session.flush()

    header_resp = await client.get("/api/v1/debt/header", headers=headers)
    assert header_resp.status_code == 200, header_resp.text
    header = header_resp.json()
    assert header["owed_to_you_minor"] >= 118000
    assert header["overdue_minor"] >= 118000
    bucket_31_60 = next(b for b in header["ageing"] if b["bucket"] == "31-60")
    assert bucket_31_60["amount_minor"] >= 118000

    accounts_resp = await client.get("/api/v1/debt/accounts", headers=headers)
    assert accounts_resp.status_code == 200, accounts_resp.text
    account = next(a for a in accounts_resp.json() if a["id"] == customer_id)
    assert account["status"] == "overdue"

    queue_resp = await client.get("/api/v1/debt/queue", headers=headers)
    assert queue_resp.status_code == 200, queue_resp.text
    queue_entry = next(e for e in queue_resp.json() if e["customer_id"] == customer_id)
    assert queue_entry["days_overdue"] >= 45
    assert queue_entry["score"] == 118000 * queue_entry["days_overdue"]


@pytest.mark.asyncio
async def test_written_off_customer_excluded_from_chase_queue(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    await _open_day(client, headers, tenant_a)
    product_id = await _create_product(client, headers)
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
    customer_id = await _create_customer(client, headers, terms_days=0)
    sale_resp = await client.post(
        "/api/v1/sales",
        headers={**headers, **idempotency_headers()},
        json={
            "location_id": tenant_a.location.id,
            "customer_id": customer_id,
            "lines": [{"product_id": product_id, "quantity": "1.0000"}],
            "payments": [{"method": "credit", "amount_minor": 118000}],
        },
    )
    assert sale_resp.status_code == 201, sale_resp.text

    write_off_resp = await client.post(
        f"/api/v1/debt/accounts/{customer_id}/write-off",
        headers={**headers, **idempotency_headers()},
        json={"reason": "Gone."},
    )
    assert write_off_resp.status_code == 201, write_off_resp.text

    queue_resp = await client.get("/api/v1/debt/queue", headers=headers)
    assert all(e["customer_id"] != customer_id for e in queue_resp.json())
