"""The Cash Box balances band, money movements, and manual balance
corrections (spec D.7.1/D.7.2).
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from operatoros_api.db import tenant_scoped_session
from operatoros_api.models.projections import MoneyLocationBalance
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
async def test_manual_update_balance_moves_money_via_money_transferred(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)

    create_resp = await client.post(
        "/api/v1/cashbox/money-locations",
        headers={**headers, **idempotency_headers()},
        json={
            "location_id": tenant_a.location.id,
            "account_key": "bank",
            "display_name": "BANK (BK **4192)",
            "masked_account_number": "**4192",
            "kind": "bank",
        },
    )
    assert create_resp.status_code == 201, create_resp.text
    money_location_id = create_resp.json()["id"]

    update_resp = await client.post(
        f"/api/v1/cashbox/money-locations/{money_location_id}/update-balance",
        headers={**headers, **idempotency_headers()},
        json={"new_balance_minor": 500000, "note": "Reconciled with bank statement"},
    )
    assert update_resp.status_code == 200, update_resp.text
    assert update_resp.json()["balance_minor"] == 500000

    async with tenant_scoped_session(tenant_a.business.id) as session:
        balance_result = await session.execute(
            select(MoneyLocationBalance).where(
                MoneyLocationBalance.location_id == tenant_a.location.id,
                MoneyLocationBalance.account_key == "bank",
            )
        )
        assert balance_result.scalar_one().balance_minor == 500000

        # The "other side" of the correction never appears as a real
        # account, but it must exist internally for the ledger to balance.
        adjustment_result = await session.execute(
            select(MoneyLocationBalance).where(
                MoneyLocationBalance.location_id == tenant_a.location.id,
                MoneyLocationBalance.account_key == "manual_adjustment",
            )
        )
        assert adjustment_result.scalar_one().balance_minor == -500000

    # A second correction, downward this time, moves money the other way.
    second_update = await client.post(
        f"/api/v1/cashbox/money-locations/{money_location_id}/update-balance",
        headers={**headers, **idempotency_headers()},
        json={"new_balance_minor": 300000},
    )
    assert second_update.status_code == 200, second_update.text
    assert second_update.json()["balance_minor"] == 300000


@pytest.mark.asyncio
async def test_manual_adjustment_account_never_appears_in_the_balances_band(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    create_resp = await client.post(
        "/api/v1/cashbox/money-locations",
        headers={**headers, **idempotency_headers()},
        json={
            "location_id": tenant_a.location.id,
            "account_key": "momo",
            "display_name": "MTN MOMO",
            "kind": "momo",
        },
    )
    money_location_id = create_resp.json()["id"]
    await client.post(
        f"/api/v1/cashbox/money-locations/{money_location_id}/update-balance",
        headers={**headers, **idempotency_headers()},
        json={"new_balance_minor": 12000},
    )

    balances_resp = await client.get(
        "/api/v1/cashbox/balances", headers=headers, params={"location_id": tenant_a.location.id}
    )
    assert balances_resp.status_code == 200, balances_resp.text
    account_keys = {card["account_key"] for card in balances_resp.json()}
    assert "manual_adjustment" not in account_keys
    momo_card = next(c for c in balances_resp.json() if c["account_key"] == "momo")
    assert momo_card["balance_minor"] == 12000
    assert momo_card["display_name"] == "MTN MOMO"


@pytest.mark.asyncio
async def test_sale_payment_appears_in_money_movements(
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
    sale_resp = await client.post(
        "/api/v1/sales",
        headers={**headers, **idempotency_headers()},
        json={
            "location_id": tenant_a.location.id,
            "lines": [{"product_id": product_id, "quantity": "1.0000"}],
            "payments": [{"method": "cash", "amount_minor": 118000}],
        },
    )
    assert sale_resp.status_code == 201, sale_resp.text

    movements_resp = await client.get(
        "/api/v1/cashbox/movements", headers=headers, params={"location_id": tenant_a.location.id}
    )
    assert movements_resp.status_code == 200, movements_resp.text
    sale_movement = next(
        m for m in movements_resp.json() if m["type"] == "Sale" and m["in_minor"] == 118000
    )
    assert sale_movement["account_key"] == "till"


@pytest.mark.asyncio
async def test_balances_do_not_leak_across_tenants_via_a_forged_location_id(
    client: AsyncClient, tenant_a: SeededTenant, tenant_b: SeededTenant
) -> None:
    """The balances/movements endpoints take `location_id` as a query
    param, not a path param, so the generic cross-tenant isolation suite
    (which only substitutes path parameters) never attacks this
    specifically -- explicit coverage here. RLS is what actually protects
    this (the query additionally filters by `location_id`, but the row
    itself is invisible outside `app.business_id`'s scope regardless)."""
    headers = await auth_headers(client, tenant_a)
    resp = await client.get(
        "/api/v1/cashbox/balances", headers=headers, params={"location_id": tenant_b.location.id}
    )
    assert resp.status_code == 200
    assert resp.json() == []

    movements_resp = await client.get(
        "/api/v1/cashbox/movements", headers=headers, params={"location_id": tenant_b.location.id}
    )
    assert movements_resp.status_code == 200
    assert movements_resp.json() == []
