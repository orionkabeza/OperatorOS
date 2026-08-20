"""MoMo reconciliation (spec D.7.3): the manual-match action (invoice /
debt payment / other income / not ours) and CSV import, landing through
the same idempotent-on-external_id staging path a webhook would.
"""

from __future__ import annotations

import io
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from operatoros_api.db import tenant_scoped_session
from operatoros_api.models.customers import CustomerBalance
from operatoros_api.models.momo import MomoTransaction
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


@pytest.mark.asyncio
async def test_matching_a_transaction_to_a_debt_payment_writes_payment_received(
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
    customer_resp = await client.post(
        "/api/v1/customers",
        headers={**headers, **idempotency_headers()},
        json={"name": "Recon Customer", "phone": f"+2507{uuid.uuid4().int % 10**8:08d}"},
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
            "location_id": tenant_a.location.id,
            "customer_id": customer_id,
            "lines": [{"product_id": product_id, "quantity": "1.0000"}],
            "payments": [{"method": "credit", "amount_minor": 118000}],
        },
    )
    assert sale_resp.status_code == 201, sale_resp.text
    sale_id = sale_resp.json()["id"]

    import_content = (
        "external_id,phone,amount_minor,direction\n"
        f"csv-{uuid.uuid4().hex[:8]},+250788000111,118000,in\n"
    ).encode()
    files = {"file": ("transactions.csv", io.BytesIO(import_content), "text/csv")}
    import_resp = await client.post(
        "/api/v1/momo/transactions/import",
        headers={**headers, **idempotency_headers()},
        files=files,
    )
    assert import_resp.status_code == 201, import_resp.text
    assert import_resp.json()["imported"] == 1

    list_resp = await client.get(
        "/api/v1/momo/transactions", headers=headers, params={"status": "unmatched"}
    )
    txn = next(t for t in list_resp.json() if t["amount_minor"] == 118000)

    match_resp = await client.post(
        f"/api/v1/momo/transactions/{txn['id']}/match",
        headers={**headers, **idempotency_headers()},
        json={
            "matched_to_type": "invoice",
            "location_id": tenant_a.location.id,
            "customer_id": customer_id,
            "sale_id": sale_id,
        },
    )
    assert match_resp.status_code == 201, match_resp.text
    assert match_resp.json()["payment_event_id"] is not None

    async with tenant_scoped_session(tenant_a.business.id) as session:
        balance_result = await session.execute(
            select(CustomerBalance).where(CustomerBalance.customer_id == customer_id)
        )
        assert balance_result.scalar_one().balance_minor == 0

        txn_result = await session.execute(
            select(MomoTransaction).where(MomoTransaction.id == txn["id"])
        )
        assert txn_result.scalar_one().status == "matched"


@pytest.mark.asyncio
async def test_not_ours_marks_ignored_without_writing_any_event(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    import_content = (
        f"external_id,phone,amount_minor\ncsv-{uuid.uuid4().hex[:8]},+250788000222,5000\n"
    ).encode()
    files = {"file": ("transactions.csv", io.BytesIO(import_content), "text/csv")}
    import_resp = await client.post(
        "/api/v1/momo/transactions/import",
        headers={**headers, **idempotency_headers()},
        files=files,
    )
    assert import_resp.status_code == 201, import_resp.text

    list_resp = await client.get(
        "/api/v1/momo/transactions", headers=headers, params={"status": "unmatched"}
    )
    txn = next(t for t in list_resp.json() if t["amount_minor"] == 5000)

    match_resp = await client.post(
        f"/api/v1/momo/transactions/{txn['id']}/match",
        headers={**headers, **idempotency_headers()},
        json={"matched_to_type": "not_ours"},
    )
    assert match_resp.status_code == 201, match_resp.text
    assert match_resp.json()["payment_event_id"] is None
    assert match_resp.json()["status"] == "ignored"


@pytest.mark.asyncio
async def test_csv_import_is_idempotent_on_external_id(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    external_id = f"csv-{uuid.uuid4().hex[:8]}"
    csv_bytes = f"external_id,phone,amount_minor\n{external_id},+250788000333,9000\n".encode()

    first = await client.post(
        "/api/v1/momo/transactions/import",
        headers={**headers, **idempotency_headers()},
        files={"file": ("t.csv", io.BytesIO(csv_bytes), "text/csv")},
    )
    assert first.status_code == 201
    assert first.json() == {"imported": 1, "skipped_duplicates": 0}

    second = await client.post(
        "/api/v1/momo/transactions/import",
        headers={**headers, **idempotency_headers()},
        files={"file": ("t.csv", io.BytesIO(csv_bytes), "text/csv")},
    )
    assert second.status_code == 201
    assert second.json() == {"imported": 0, "skipped_duplicates": 1}
