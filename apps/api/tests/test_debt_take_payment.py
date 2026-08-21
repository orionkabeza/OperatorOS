"""`take payment` (spec D.6.4, plan §0.2/§3): allocation (auto-oldest-first
and manual per invoice), the back-dating permission gate, and
`sales.due_date_at` being snapshotted at sale time rather than live-joined
to the customer's current terms.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from operatoros_api.db import tenant_scoped_session
from operatoros_api.models.payments import PaymentAllocation
from operatoros_api.models.projections import MoneyLocationBalance
from operatoros_api.models.sales import Sale
from operatoros_api.seed import create_user
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


async def _create_product(
    client: AsyncClient, headers: dict, *, selling_price_minor: int = 100000
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
            "cost_price_minor": 50000,
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
            "unit_cost_minor": 50000,
        },
    )
    assert resp.status_code == 201, resp.text


async def _create_customer(
    client: AsyncClient,
    headers: dict,
    *,
    credit_limit_minor: int,
    terms_days: int = 30,
    name: str = "Kigali Builders Ltd",
) -> str:
    resp = await client.post(
        "/api/v1/customers",
        headers={**headers, **idempotency_headers()},
        json={
            "name": name,
            "phone": f"+2507{uuid.uuid4().int % 10**8:08d}",
            "terms_days": terms_days,
        },
    )
    assert resp.status_code == 201, resp.text
    customer_id = resp.json()["id"]
    limit_resp = await client.post(
        f"/api/v1/customers/{customer_id}/credit-limit",
        headers={**headers, **idempotency_headers()},
        json={"new_limit_minor": credit_limit_minor},
    )
    assert limit_resp.status_code == 200, limit_resp.text
    return customer_id


async def _credit_sale(
    client: AsyncClient,
    headers: dict,
    tenant: SeededTenant,
    *,
    product_id: str,
    customer_id: str,
    amount_minor: int,
) -> str:
    resp = await client.post(
        "/api/v1/sales",
        headers={**headers, **idempotency_headers()},
        json={
            "location_id": tenant.location.id,
            "customer_id": customer_id,
            "lines": [{"product_id": product_id, "quantity": "1.0000"}],
            "payments": [{"method": "credit", "amount_minor": amount_minor}],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


@pytest.mark.asyncio
async def test_due_date_at_snapshotted_at_sale_time_not_live_joined(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    await _open_day(client, headers, tenant_a)
    product_id = await _create_product(client, headers, selling_price_minor=100000)
    await _receive_stock(client, headers, tenant_a, product_id, "5.0000")
    customer_id = await _create_customer(client, headers, credit_limit_minor=1000000, terms_days=30)

    sale_id = await _credit_sale(
        client,
        headers,
        tenant_a,
        product_id=product_id,
        customer_id=customer_id,
        amount_minor=118000,
    )

    async with tenant_scoped_session(tenant_a.business.id) as session:
        sale = await session.get(Sale, sale_id)
        assert sale is not None
        assert sale.due_date_at is not None
        expected = datetime.now(UTC) + timedelta(days=30)
        assert abs((sale.due_date_at - expected).total_seconds()) < 60

    # Now change the customer's terms -- the ALREADY-ISSUED invoice's due
    # date must not move.
    patch_resp = await client.patch(
        f"/api/v1/customers/{customer_id}",
        headers={**headers, **idempotency_headers()},
        json={"terms_days": 90},
    )
    assert patch_resp.status_code == 200, patch_resp.text

    async with tenant_scoped_session(tenant_a.business.id) as session:
        sale_after = await session.get(Sale, sale_id)
        assert sale_after is not None
        assert (
            sale_after.due_date_at == sale.due_date_at
        ), "due_date_at moved after a later terms_days change -- it must be snapshotted"


@pytest.mark.asyncio
async def test_take_payment_auto_allocates_oldest_invoice_first(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    await _open_day(client, headers, tenant_a)
    product_id = await _create_product(client, headers, selling_price_minor=100000)
    await _receive_stock(client, headers, tenant_a, product_id, "5.0000")
    customer_id = await _create_customer(client, headers, credit_limit_minor=1000000, terms_days=10)

    sale_1 = await _credit_sale(
        client,
        headers,
        tenant_a,
        product_id=product_id,
        customer_id=customer_id,
        amount_minor=118000,
    )
    sale_2 = await _credit_sale(
        client,
        headers,
        tenant_a,
        product_id=product_id,
        customer_id=customer_id,
        amount_minor=118000,
    )

    # Both invoices carry the same due date (same terms_days, same moment)
    # -- the tie-break is created_at, so sale_1 (created first) is still
    # "oldest" and should be paid off completely before any of sale_2 is
    # touched.
    take_resp = await client.post(
        f"/api/v1/debt/accounts/{customer_id}/take-payment",
        headers={**headers, **idempotency_headers()},
        json={
            "location_id": tenant_a.location.id,
            "amount_minor": 150000,
            "method": "cash",
            "allocation_mode": "auto",
        },
    )
    assert take_resp.status_code == 201, take_resp.text
    body = take_resp.json()
    assert body["amount_minor"] == 150000
    assert body["customer_balance_minor"] == 118000 * 2 - 150000

    allocations = {a["sale_id"]: a["amount_minor"] for a in body["allocations"]}
    assert allocations[sale_1] == 118000, "the oldest invoice must be paid off in full first"
    assert allocations[sale_2] == 150000 - 118000

    async with tenant_scoped_session(tenant_a.business.id) as session:
        pa_result = await session.execute(
            select(PaymentAllocation).where(PaymentAllocation.business_id == tenant_a.business.id)
        )
        rows = list(pa_result.scalars())
        assert sum(r.amount_minor for r in rows) == 150000

        till_result = await session.execute(
            select(MoneyLocationBalance).where(
                MoneyLocationBalance.location_id == tenant_a.location.id,
                MoneyLocationBalance.account_key == "till",
            )
        )
        # A fresh tenant's till only ever received this one payment.
        assert till_result.scalar_one().balance_minor == 150000


@pytest.mark.asyncio
async def test_take_payment_manual_allocation_targets_named_invoice(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    await _open_day(client, headers, tenant_a)
    product_id = await _create_product(client, headers, selling_price_minor=100000)
    await _receive_stock(client, headers, tenant_a, product_id, "5.0000")
    customer_id = await _create_customer(client, headers, credit_limit_minor=1000000)

    sale_1 = await _credit_sale(
        client,
        headers,
        tenant_a,
        product_id=product_id,
        customer_id=customer_id,
        amount_minor=118000,
    )
    sale_2 = await _credit_sale(
        client,
        headers,
        tenant_a,
        product_id=product_id,
        customer_id=customer_id,
        amount_minor=118000,
    )

    take_resp = await client.post(
        f"/api/v1/debt/accounts/{customer_id}/take-payment",
        headers={**headers, **idempotency_headers()},
        json={
            "location_id": tenant_a.location.id,
            "amount_minor": 50000,
            "method": "momo",
            "allocation_mode": "manual",
            "manual_allocations": [{"sale_id": sale_2, "amount_minor": 50000}],
        },
    )
    assert take_resp.status_code == 201, take_resp.text
    body = take_resp.json()
    assert body["allocations"] == [{"sale_id": sale_2, "amount_minor": 50000}]

    invoices_resp = await client.get(
        f"/api/v1/debt/accounts/{customer_id}/invoices", headers=headers
    )
    remaining = {inv["sale_id"]: inv["remaining_minor"] for inv in invoices_resp.json()}
    assert remaining[sale_1] == 118000, "the untouched invoice must be unaffected"
    assert remaining[sale_2] == 118000 - 50000


@pytest.mark.asyncio
async def test_take_payment_manual_allocation_must_sum_to_amount(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    await _open_day(client, headers, tenant_a)
    product_id = await _create_product(client, headers, selling_price_minor=100000)
    await _receive_stock(client, headers, tenant_a, product_id, "5.0000")
    customer_id = await _create_customer(client, headers, credit_limit_minor=1000000)
    sale_1 = await _credit_sale(
        client,
        headers,
        tenant_a,
        product_id=product_id,
        customer_id=customer_id,
        amount_minor=118000,
    )

    resp = await client.post(
        f"/api/v1/debt/accounts/{customer_id}/take-payment",
        headers={**headers, **idempotency_headers()},
        json={
            "location_id": tenant_a.location.id,
            "amount_minor": 50000,
            "method": "cash",
            "allocation_mode": "manual",
            "manual_allocations": [{"sale_id": sale_1, "amount_minor": 40000}],
        },
    )
    assert resp.status_code == 422
    assert "match exactly" in resp.text


@pytest.mark.asyncio
async def test_take_payment_auto_allocation_cannot_exceed_open_invoices(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    await _open_day(client, headers, tenant_a)
    product_id = await _create_product(client, headers, selling_price_minor=100000)
    await _receive_stock(client, headers, tenant_a, product_id, "5.0000")
    customer_id = await _create_customer(client, headers, credit_limit_minor=1000000)
    await _credit_sale(
        client,
        headers,
        tenant_a,
        product_id=product_id,
        customer_id=customer_id,
        amount_minor=118000,
    )

    resp = await client.post(
        f"/api/v1/debt/accounts/{customer_id}/take-payment",
        headers={**headers, **idempotency_headers()},
        json={
            "location_id": tenant_a.location.id,
            "amount_minor": 999999999,
            "method": "cash",
            "allocation_mode": "auto",
        },
    )
    assert resp.status_code == 422
    assert "exceeds" in resp.text


@pytest.mark.asyncio
async def test_back_dated_payment_requires_permission_and_reason(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    owner_headers = await auth_headers(client, tenant_a)
    await _open_day(client, owner_headers, tenant_a)
    product_id = await _create_product(client, owner_headers, selling_price_minor=100000)
    await _receive_stock(client, owner_headers, tenant_a, product_id, "5.0000")
    customer_id = await _create_customer(client, owner_headers, credit_limit_minor=1000000)
    await _credit_sale(
        client,
        owner_headers,
        tenant_a,
        product_id=product_id,
        customer_id=customer_id,
        amount_minor=118000,
    )

    async with tenant_scoped_session(tenant_a.business.id) as session:
        cashier = await create_user(
            session,
            business_id=tenant_a.business.id,
            role=tenant_a.roles["cashier"],
            display_name="Cashier",
            secret="713245",
            phone=f"+2507{uuid.uuid4().int % 10**8:08d}",
            location_ids=[tenant_a.location.id],
        )
        cashier_phone = cashier.phone

    login_resp = await client.post(
        "/api/v1/auth/login",
        json={
            "business_slug": tenant_a.business.slug,
            "identifier": cashier_phone,
            "secret": "713245",
            "device_id": f"device-{uuid.uuid4().hex[:8]}",
        },
    )
    assert login_resp.status_code == 200, login_resp.text
    cashier_headers = {"Authorization": f"Bearer {login_resp.json()['access_token']}"}

    back_date = (datetime.now(UTC) - timedelta(days=3)).isoformat()

    # A cashier holds debt.take_payment but not debt.back_date_payment.
    forbidden_resp = await client.post(
        f"/api/v1/debt/accounts/{customer_id}/take-payment",
        headers={**cashier_headers, **idempotency_headers()},
        json={
            "location_id": tenant_a.location.id,
            "amount_minor": 50000,
            "method": "cash",
            "allocation_mode": "auto",
            "received_at": back_date,
        },
    )
    assert forbidden_resp.status_code == 403, forbidden_resp.text

    # The owner has the permission but must still supply a reason.
    no_reason_resp = await client.post(
        f"/api/v1/debt/accounts/{customer_id}/take-payment",
        headers={**owner_headers, **idempotency_headers()},
        json={
            "location_id": tenant_a.location.id,
            "amount_minor": 50000,
            "method": "cash",
            "allocation_mode": "auto",
            "received_at": back_date,
        },
    )
    assert no_reason_resp.status_code == 422, no_reason_resp.text

    ok_resp = await client.post(
        f"/api/v1/debt/accounts/{customer_id}/take-payment",
        headers={**owner_headers, **idempotency_headers()},
        json={
            "location_id": tenant_a.location.id,
            "amount_minor": 50000,
            "method": "cash",
            "allocation_mode": "auto",
            "received_at": back_date,
            "back_date_reason": "Cash was actually received on Friday, recorded late.",
        },
    )
    assert ok_resp.status_code == 201, ok_resp.text


@pytest.mark.asyncio
async def test_write_off_below_threshold_succeeds_without_confirmation(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    await _open_day(client, headers, tenant_a)
    product_id = await _create_product(client, headers, selling_price_minor=10000)
    await _receive_stock(client, headers, tenant_a, product_id, "5.0000")
    customer_id = await _create_customer(client, headers, credit_limit_minor=1000000)
    await _credit_sale(
        client,
        headers,
        tenant_a,
        product_id=product_id,
        customer_id=customer_id,
        amount_minor=11800,
    )

    resp = await client.post(
        f"/api/v1/debt/accounts/{customer_id}/write-off",
        headers={**headers, **idempotency_headers()},
        json={"reason": "Customer went out of business."},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["amount_written_off_minor"] == 11800

    account_resp = await client.get(f"/api/v1/debt/accounts/{customer_id}", headers=headers)
    assert account_resp.json()["status"] == "written_off"
    assert account_resp.json()["balance_minor"] == 0


@pytest.mark.asyncio
async def test_write_off_above_threshold_requires_exact_customer_name(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    await _open_day(client, headers, tenant_a)
    product_id = await _create_product(client, headers, selling_price_minor=500000)
    await _receive_stock(client, headers, tenant_a, product_id, "5.0000")
    customer_id = await _create_customer(
        client, headers, credit_limit_minor=10000000, name="Big Debtor Ltd"
    )
    # 500000 * 1.18 = 590000 minor units, well above the confirm threshold.
    await _credit_sale(
        client,
        headers,
        tenant_a,
        product_id=product_id,
        customer_id=customer_id,
        amount_minor=590000,
    )

    wrong_name_resp = await client.post(
        f"/api/v1/debt/accounts/{customer_id}/write-off",
        headers={**headers, **idempotency_headers()},
        json={"reason": "Vanished.", "confirm_customer_name": "Someone Else"},
    )
    assert wrong_name_resp.status_code == 422, wrong_name_resp.text

    ok_resp = await client.post(
        f"/api/v1/debt/accounts/{customer_id}/write-off",
        headers={**headers, **idempotency_headers()},
        json={"reason": "Vanished.", "confirm_customer_name": "Big Debtor Ltd"},
    )
    assert ok_resp.status_code == 201, ok_resp.text


@pytest.mark.asyncio
async def test_concurrent_take_payments_do_not_double_allocate_the_same_invoice(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    """Two genuinely independent take-payment calls (different
    Idempotency-Keys -- e.g. a cashier at the counter and someone settling
    the same customer's account by phone at the same instant), each paying
    off the customer's ONE open invoice in full, racing each other.

    `_open_invoices_for_customer` (debt_ageing.py) reads `sales` +
    `payment_allocations` with no row lock before the allocation decision is
    made, unlike the stock-check race Phase 1 already closed with
    `.with_for_update()` on `product_locations`
    (api/routers/sales.py::_check_stock`). If both requests read the
    invoice's `remaining_minor` before either has written its
    `PaymentAllocation` row, both can allocate the full amount to the SAME
    invoice: exactly the same "check-then-write across a request boundary
    without locking the read" shape.

    Correct behaviour, matching
    tests/test_sales_atomicity.py::test_concurrent_sales_for_the_last_unit_do_not_oversell:
    exactly one payment fully allocates to the invoice and the other is
    cleanly rejected (422, nothing left open to allocate against) --
    never two 201s that together over-allocate the same invoice.
    """
    headers = await auth_headers(client, tenant_a)
    await _open_day(client, headers, tenant_a)
    product_id = await _create_product(client, headers, selling_price_minor=100000)
    await _receive_stock(client, headers, tenant_a, product_id, "5.0000")
    customer_id = await _create_customer(client, headers, credit_limit_minor=1000000)

    sale_id = await _credit_sale(
        client,
        headers,
        tenant_a,
        product_id=product_id,
        customer_id=customer_id,
        amount_minor=118000,
    )

    async def fire(idem_key: str):
        return await client.post(
            f"/api/v1/debt/accounts/{customer_id}/take-payment",
            headers={**headers, "Idempotency-Key": idem_key},
            json={
                "location_id": tenant_a.location.id,
                "amount_minor": 118000,
                "method": "cash",
                "allocation_mode": "auto",
            },
        )

    resp1, resp2 = await asyncio.gather(
        fire(f"pay-race-a-{uuid.uuid4().hex}"), fire(f"pay-race-b-{uuid.uuid4().hex}")
    )

    statuses = sorted([resp1.status_code, resp2.status_code])
    assert statuses == [201, 422], (
        "exactly one of the two concurrent payments must succeed (fully allocating the "
        "customer's one open invoice) and the other must be cleanly rejected for having "
        f"nothing left to allocate against -- got {resp1.status_code} and {resp2.status_code}"
    )

    async with tenant_scoped_session(tenant_a.business.id) as session:
        pa_result = await session.execute(
            select(PaymentAllocation).where(
                PaymentAllocation.business_id == tenant_a.business.id,
                PaymentAllocation.sale_id == sale_id,
            )
        )
        rows = list(pa_result.scalars())
        total_allocated = sum(r.amount_minor for r in rows)
        sale = await session.get(Sale, sale_id)
        assert total_allocated <= sale.total_minor, (
            f"invoice {sale_id} (total {sale.total_minor}) was over-allocated: "
            f"payment_allocations sum to {total_allocated} across {len(rows)} row(s)"
        )
