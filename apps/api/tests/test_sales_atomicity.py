"""The Counter's sale-recording endpoint (spec D.4, plan §3) is the most
safety-critical piece of Phase 1: it must be one atomic transaction that
validates the basket, checks the credit limit, and drives every downstream
projection together -- and it must survive a retried request from a flaky
connection without double-selling.

Same idempotency proof shape as Phase 0's tests/test_idempotency.py
(fire twice with asyncio.gather, assert exactly one write), applied to the
real sale endpoint end-to-end through the HTTP layer, plus the credit-limit
block/override and basic stock/money-movement correctness the plan calls
out explicitly.
"""

from __future__ import annotations

import asyncio
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from operatoros_api.db import tenant_scoped_session
from operatoros_api.models.catalog import ProductLocation
from operatoros_api.models.customers import CustomerBalance
from operatoros_api.models.day_till import DaySession
from operatoros_api.models.events import Event
from operatoros_api.models.projections import MoneyLocationBalance
from operatoros_api.models.sales import Sale
from tests.conftest import SeededTenant
from tests.helpers import auth_headers, idempotency_headers


async def _open_day(client: AsyncClient, headers: dict, tenant: SeededTenant) -> None:
    """`tenant_a`/`tenant_b` fixtures already seed one open DaySession for
    their location directly (tests/conftest.py::make_tenant, needed so the
    cross-tenant isolation suite has a day/till_session_id to attack) -- so
    this only opens a fresh one if that seeded session isn't there /
    somehow already closed, rather than assuming a 201."""
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


async def _create_product(
    client: AsyncClient, headers: dict, tenant: SeededTenant, *, selling_price_minor: int = 150000
) -> str:
    unit_resp = await client.post(
        "/api/v1/products/units",
        headers={**headers, **idempotency_headers()},
        json={"name": f"unit-{uuid.uuid4().hex[:6]}", "symbol": "pc"},
    )
    assert unit_resp.status_code == 201, unit_resp.text
    unit_id = unit_resp.json()["id"]

    product_resp = await client.post(
        "/api/v1/products",
        headers={**headers, **idempotency_headers()},
        json={
            "name": f"Cement {uuid.uuid4().hex[:6]}",
            "base_unit_id": unit_id,
            "cost_price_minor": 100000,
            "selling_price_minor": selling_price_minor,
        },
    )
    assert product_resp.status_code == 201, product_resp.text
    return product_resp.json()["id"]


async def _receive_stock(
    client: AsyncClient, headers: dict, tenant: SeededTenant, product_id: str, quantity: str
) -> None:
    resp = await client.post(
        "/api/v1/stock/receive",
        headers={**headers, **idempotency_headers()},
        json={
            "product_id": product_id,
            "location_id": tenant.location.id,
            "quantity": quantity,
            "unit_cost_minor": 100000,
        },
    )
    assert resp.status_code == 201, resp.text


async def _create_customer(
    client: AsyncClient, headers: dict, tenant: SeededTenant, *, credit_limit_minor: int
) -> str:
    resp = await client.post(
        "/api/v1/customers",
        headers={**headers, **idempotency_headers()},
        json={"name": "Kigali Builders Ltd", "phone": "+250788111222"},
    )
    assert resp.status_code == 201, resp.text
    customer_id = resp.json()["id"]

    # Owner (tenant_a) always has customer.manage, so the credit-limit change
    # applies for real -- see api/routers/customers.py::create_customer.
    limit_resp = await client.post(
        f"/api/v1/customers/{customer_id}/credit-limit",
        headers={**headers, **idempotency_headers()},
        json={"new_limit_minor": credit_limit_minor},
    )
    assert limit_resp.status_code == 200, limit_resp.text
    return customer_id


@pytest.mark.asyncio
async def test_cash_sale_moves_stock_and_till_balance_correctly(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    await _open_day(client, headers, tenant_a)
    product_id = await _create_product(client, headers, tenant_a, selling_price_minor=150000)
    await _receive_stock(client, headers, tenant_a, product_id, "50.0000")

    resp = await client.post(
        "/api/v1/sales",
        headers={**headers, **idempotency_headers()},
        json={
            "location_id": tenant_a.location.id,
            "lines": [{"product_id": product_id, "quantity": "3.0000"}],
            "payments": [{"method": "cash", "amount_minor": 3 * 150000 * 118 // 100}],
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["total_minor"] == 3 * 150000 * 118 // 100
    assert body["status"] == "completed"

    async with tenant_scoped_session(tenant_a.business.id) as session:
        stock_result = await session.execute(
            select(ProductLocation).where(
                ProductLocation.product_id == product_id,
                ProductLocation.location_id == tenant_a.location.id,
            )
        )
        stock_row = stock_result.scalar_one()
        assert stock_row.on_hand == 47  # 50 received - 3 sold

        till_result = await session.execute(
            select(MoneyLocationBalance).where(
                MoneyLocationBalance.location_id == tenant_a.location.id,
                MoneyLocationBalance.account_key == "till",
            )
        )
        assert till_result.scalar_one().balance_minor == body["total_minor"]


@pytest.mark.asyncio
async def test_concurrent_double_submit_with_same_idempotency_key_sells_exactly_once(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    await _open_day(client, headers, tenant_a)
    product_id = await _create_product(client, headers, tenant_a, selling_price_minor=100000)
    await _receive_stock(client, headers, tenant_a, product_id, "20.0000")

    idem_key = f"sale-{uuid.uuid4().hex}"
    body = {
        "location_id": tenant_a.location.id,
        "lines": [{"product_id": product_id, "quantity": "1.0000"}],
        "payments": [{"method": "cash", "amount_minor": 118000}],
    }

    async def fire():
        return await client.post(
            "/api/v1/sales", headers={**headers, "Idempotency-Key": idem_key}, json=body
        )

    resp1, resp2 = await asyncio.gather(fire(), fire())

    assert resp1.status_code == 201, resp1.text
    assert resp2.status_code == 201, resp2.text
    assert resp1.json() == resp2.json(), "both responses must be the exact same sale"

    async with tenant_scoped_session(tenant_a.business.id) as session:
        sales_result = await session.execute(
            select(Sale).where(
                Sale.business_id == tenant_a.business.id, Sale.id != tenant_a.sale_id
            )
        )
        assert len(sales_result.all()) == 1, "exactly one sale must exist, not two"

        events_result = await session.execute(
            select(Event).where(
                Event.business_id == tenant_a.business.id, Event.type == "SALE_RECORDED"
            )
        )
        assert len(events_result.all()) == 1, "exactly one SALE_RECORDED event must exist"

        stock_result = await session.execute(
            select(ProductLocation).where(ProductLocation.product_id == product_id)
        )
        assert stock_result.scalar_one().on_hand == 19, "stock must only decrement once (20 - 1)"


@pytest.mark.asyncio
async def test_sequential_replay_with_same_key_does_not_double_sell(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    await _open_day(client, headers, tenant_a)
    product_id = await _create_product(client, headers, tenant_a, selling_price_minor=100000)
    await _receive_stock(client, headers, tenant_a, product_id, "10.0000")

    idem_key = f"sale-seq-{uuid.uuid4().hex}"
    body = {
        "location_id": tenant_a.location.id,
        "lines": [{"product_id": product_id, "quantity": "2.0000"}],
        "payments": [{"method": "cash", "amount_minor": 236000}],
    }

    first = await client.post(
        "/api/v1/sales", headers={**headers, "Idempotency-Key": idem_key}, json=body
    )
    second = await client.post(
        "/api/v1/sales", headers={**headers, "Idempotency-Key": idem_key}, json=body
    )
    assert first.status_code == second.status_code == 201
    assert first.json() == second.json()

    async with tenant_scoped_session(tenant_a.business.id) as session:
        result = await session.execute(
            select(Sale).where(
                Sale.business_id == tenant_a.business.id, Sale.id != tenant_a.sale_id
            )
        )
        assert len(result.all()) == 1


@pytest.mark.asyncio
async def test_sale_blocks_without_day_open(client: AsyncClient, tenant_a: SeededTenant) -> None:
    """`tenant_a` seeds an open DaySession by default (tests/conftest.py) --
    close it first to reach the genuinely-no-open-day state this test is
    about."""
    headers = await auth_headers(client, tenant_a)
    async with tenant_scoped_session(tenant_a.business.id) as session:
        day = await session.get(DaySession, tenant_a.day_session.id)
        day.status = "closed"

    product_id = await _create_product(client, headers, tenant_a)
    resp = await client.post(
        "/api/v1/sales",
        headers={**headers, **idempotency_headers()},
        json={
            "location_id": tenant_a.location.id,
            "lines": [{"product_id": product_id, "quantity": "1.0000"}],
            "payments": [{"method": "cash", "amount_minor": 118000}],
        },
    )
    assert resp.status_code == 409
    assert "isn't open" in resp.text


@pytest.mark.asyncio
async def test_sale_blocks_when_stock_insufficient(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    await _open_day(client, headers, tenant_a)
    product_id = await _create_product(client, headers, tenant_a)
    await _receive_stock(client, headers, tenant_a, product_id, "1.0000")

    resp = await client.post(
        "/api/v1/sales",
        headers={**headers, **idempotency_headers()},
        json={
            "location_id": tenant_a.location.id,
            "lines": [{"product_id": product_id, "quantity": "5.0000"}],
            "payments": [{"method": "cash", "amount_minor": 5 * 118000}],
        },
    )
    assert resp.status_code == 422
    assert "Stock check failed" in resp.text

    async with tenant_scoped_session(tenant_a.business.id) as session:
        result = await session.execute(
            select(Sale).where(
                Sale.business_id == tenant_a.business.id, Sale.id != tenant_a.sale_id
            )
        )
        assert result.first() is None, "a blocked sale must leave no Sale row behind"


@pytest.mark.asyncio
async def test_credit_sale_within_limit_succeeds(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    await _open_day(client, headers, tenant_a)
    product_id = await _create_product(client, headers, tenant_a, selling_price_minor=100000)
    await _receive_stock(client, headers, tenant_a, product_id, "10.0000")
    customer_id = await _create_customer(client, headers, tenant_a, credit_limit_minor=1000000)

    resp = await client.post(
        "/api/v1/sales",
        headers={**headers, **idempotency_headers()},
        json={
            "location_id": tenant_a.location.id,
            "customer_id": customer_id,
            "lines": [{"product_id": product_id, "quantity": "1.0000"}],
            "payments": [{"method": "credit", "amount_minor": 118000}],
        },
    )
    assert resp.status_code == 201, resp.text

    async with tenant_scoped_session(tenant_a.business.id) as session:
        balance_result = await session.execute(
            select(CustomerBalance).where(CustomerBalance.customer_id == customer_id)
        )
        assert balance_result.scalar_one().balance_minor == 118000


@pytest.mark.asyncio
async def test_credit_sale_over_limit_is_blocked_without_override(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    await _open_day(client, headers, tenant_a)
    product_id = await _create_product(client, headers, tenant_a, selling_price_minor=100000)
    await _receive_stock(client, headers, tenant_a, product_id, "10.0000")
    customer_id = await _create_customer(client, headers, tenant_a, credit_limit_minor=50000)

    resp = await client.post(
        "/api/v1/sales",
        headers={**headers, **idempotency_headers()},
        json={
            "location_id": tenant_a.location.id,
            "customer_id": customer_id,
            "lines": [{"product_id": product_id, "quantity": "1.0000"}],
            "payments": [{"method": "credit", "amount_minor": 118000}],
        },
    )
    assert resp.status_code == 422, resp.text
    assert "credit limit" in resp.text

    async with tenant_scoped_session(tenant_a.business.id) as session:
        result = await session.execute(
            select(Sale).where(
                Sale.business_id == tenant_a.business.id, Sale.id != tenant_a.sale_id
            )
        )
        assert result.first() is None, "a credit-blocked sale must leave no Sale row behind"

        balance_result = await session.execute(
            select(CustomerBalance).where(CustomerBalance.customer_id == customer_id)
        )
        assert balance_result.scalar_one().balance_minor == 0


@pytest.mark.asyncio
async def test_credit_sale_over_limit_succeeds_with_verified_manager_override(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    await _open_day(client, headers, tenant_a)
    product_id = await _create_product(client, headers, tenant_a, selling_price_minor=100000)
    await _receive_stock(client, headers, tenant_a, product_id, "10.0000")
    customer_id = await _create_customer(client, headers, tenant_a, credit_limit_minor=50000)

    resp = await client.post(
        "/api/v1/sales",
        headers={**headers, **idempotency_headers()},
        json={
            "location_id": tenant_a.location.id,
            "customer_id": customer_id,
            "lines": [{"product_id": product_id, "quantity": "1.0000"}],
            "payments": [{"method": "credit", "amount_minor": 118000}],
            "manager_override_user_id": tenant_a.owner.id,
            "manager_override_pin": tenant_a.owner_secret,
            "override_reason": "Regular customer, paying tomorrow",
        },
    )
    assert resp.status_code == 201, resp.text

    async with tenant_scoped_session(tenant_a.business.id) as session:
        sale_result = await session.execute(
            select(Sale).where(
                Sale.business_id == tenant_a.business.id, Sale.id != tenant_a.sale_id
            )
        )
        sale = sale_result.scalar_one()
        assert sale.credit_override_by_user_id == tenant_a.owner.id
        assert sale.credit_override_reason == "Regular customer, paying tomorrow"


@pytest.mark.asyncio
async def test_credit_sale_over_limit_wrong_pin_is_rejected(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    await _open_day(client, headers, tenant_a)
    product_id = await _create_product(client, headers, tenant_a, selling_price_minor=100000)
    await _receive_stock(client, headers, tenant_a, product_id, "10.0000")
    customer_id = await _create_customer(client, headers, tenant_a, credit_limit_minor=50000)

    resp = await client.post(
        "/api/v1/sales",
        headers={**headers, **idempotency_headers()},
        json={
            "location_id": tenant_a.location.id,
            "customer_id": customer_id,
            "lines": [{"product_id": product_id, "quantity": "1.0000"}],
            "payments": [{"method": "credit", "amount_minor": 118000}],
            "manager_override_user_id": tenant_a.owner.id,
            "manager_override_pin": "000000",
            "override_reason": "trying to sneak past",
        },
    )
    assert resp.status_code == 422, resp.text
    assert "credit limit" in resp.text


@pytest.mark.asyncio
async def test_payments_not_matching_total_are_rejected(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    await _open_day(client, headers, tenant_a)
    product_id = await _create_product(client, headers, tenant_a, selling_price_minor=100000)
    await _receive_stock(client, headers, tenant_a, product_id, "10.0000")

    resp = await client.post(
        "/api/v1/sales",
        headers={**headers, **idempotency_headers()},
        json={
            "location_id": tenant_a.location.id,
            "lines": [{"product_id": product_id, "quantity": "1.0000"}],
            "payments": [{"method": "cash", "amount_minor": 1000}],
        },
    )
    assert resp.status_code == 422
    assert "Payments total" in resp.text


@pytest.mark.asyncio
async def test_missing_idempotency_key_is_rejected(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    await _open_day(client, headers, tenant_a)
    product_id = await _create_product(client, headers, tenant_a)
    resp = await client.post(
        "/api/v1/sales",
        headers=headers,
        json={
            "location_id": tenant_a.location.id,
            "lines": [{"product_id": product_id, "quantity": "1.0000"}],
            "payments": [{"method": "cash", "amount_minor": 118000}],
        },
    )
    assert resp.status_code == 400
