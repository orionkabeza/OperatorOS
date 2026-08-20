"""Stock-take lifecycle (spec D.5.4) and transfers (spec D.5.5), plan §3.

End-to-end through the HTTP layer: start -> count -> review -> post for
stock-takes (corrections are movements, nothing is silently overwritten);
create -> in-transit -> receive (matching and mismatched quantity) for
transfers.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from operatoros_api.db import tenant_scoped_session
from operatoros_api.models.catalog import ProductLocation
from operatoros_api.models.stock import StockMovement
from operatoros_api.models.tenancy import Location
from tests.conftest import SeededTenant
from tests.helpers import auth_headers, idempotency_headers


async def _create_product(
    client: AsyncClient, headers: dict, *, selling_price_minor: int = 150000
) -> str:
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
            "name": f"Product {uuid.uuid4().hex[:6]}",
            "base_unit_id": unit_id,
            "cost_price_minor": 100000,
            "selling_price_minor": selling_price_minor,
        },
    )
    assert product_resp.status_code == 201, product_resp.text
    return product_resp.json()["id"]


async def _receive_stock(
    client: AsyncClient, headers: dict, tenant, product_id: str, quantity: str
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


@pytest.mark.asyncio
async def test_stocktake_lifecycle_posts_a_correction_and_moves_stock(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    product_id = await _create_product(client, headers)
    await _receive_stock(client, headers, tenant_a, product_id, "50.0000")

    start_resp = await client.post(
        "/api/v1/stock/stocktakes",
        headers={**headers, **idempotency_headers()},
        json={"location_id": tenant_a.location.id, "scope": "list", "product_ids": [product_id]},
    )
    assert start_resp.status_code == 201, start_resp.text
    stocktake = start_resp.json()
    assert stocktake["status"] == "counting"
    assert len(stocktake["lines"]) == 1
    line = stocktake["lines"][0]
    assert line["expected_quantity"] == "50.0000"

    # 20 units short at cost_price_minor=100000 => 2,000,000 minor units,
    # comfortably over VARIANCE_REASON_REQUIRED_THRESHOLD_MINOR (1,000,000)
    # so the reason-required path below is actually exercised.
    count_resp = await client.post(
        f"/api/v1/stock/stocktakes/{stocktake['id']}/lines/{line['id']}/count",
        headers=headers,
        json={"counted_quantity": "30.0000"},
    )
    assert count_resp.status_code == 200, count_resp.text
    counted_line = count_resp.json()
    assert counted_line["variance_qty"] == "-20.0000"
    assert counted_line["variance_value_minor"] == -2000000

    review_resp = await client.get(
        f"/api/v1/stock/stocktakes/{stocktake['id']}/review", headers=headers
    )
    assert review_resp.status_code == 200, review_resp.text
    review = review_resp.json()
    assert len(review) == 1
    assert review[0]["product_id"] == product_id

    # Variance exceeds the reason threshold -- posting without one is blocked.
    blocked_post = await client.post(
        f"/api/v1/stock/stocktakes/{stocktake['id']}/post",
        headers={**headers, **idempotency_headers()},
    )
    assert blocked_post.status_code == 422, blocked_post.text
    assert "reason" in blocked_post.text

    reason_resp = await client.post(
        f"/api/v1/stock/stocktakes/{stocktake['id']}/lines/{line['id']}/reason",
        headers=headers,
        json={"reason": "Shrinkage -- suspected theft"},
    )
    assert reason_resp.status_code == 200, reason_resp.text

    post_resp = await client.post(
        f"/api/v1/stock/stocktakes/{stocktake['id']}/post",
        headers={**headers, **idempotency_headers()},
    )
    assert post_resp.status_code == 200, post_resp.text
    posted = post_resp.json()
    assert posted["status"] == "posted"
    assert posted["variance_value_minor"] == -2000000

    async with tenant_scoped_session(tenant_a.business.id) as session:
        stock_result = await session.execute(
            select(ProductLocation).where(ProductLocation.product_id == product_id)
        )
        assert stock_result.scalar_one().on_hand == 30

        movement_result = await session.execute(
            select(StockMovement).where(
                StockMovement.product_id == product_id, StockMovement.movement_type == "adjustment"
            )
        )
        movements = list(movement_result.scalars())
        assert len(movements) == 1
        assert movements[0].quantity_delta == -20


@pytest.mark.asyncio
async def test_stocktake_posting_twice_is_rejected(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    product_id = await _create_product(client, headers)
    await _receive_stock(client, headers, tenant_a, product_id, "10.0000")

    start_resp = await client.post(
        "/api/v1/stock/stocktakes",
        headers={**headers, **idempotency_headers()},
        json={"location_id": tenant_a.location.id, "scope": "list", "product_ids": [product_id]},
    )
    stocktake_id = start_resp.json()["id"]

    first_post = await client.post(
        f"/api/v1/stock/stocktakes/{stocktake_id}/post",
        headers={**headers, **idempotency_headers()},
    )
    assert first_post.status_code == 200, first_post.text

    second_post = await client.post(
        f"/api/v1/stock/stocktakes/{stocktake_id}/post",
        headers={**headers, **idempotency_headers()},
    )
    assert second_post.status_code == 409


@pytest.mark.asyncio
async def test_frozen_stocktake_blocks_a_sale_until_posted(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    product_id = await _create_product(client, headers, selling_price_minor=100000)
    await _receive_stock(client, headers, tenant_a, product_id, "10.0000")

    start_resp = await client.post(
        "/api/v1/stock/stocktakes",
        headers={**headers, **idempotency_headers()},
        json={
            "location_id": tenant_a.location.id,
            "scope": "list",
            "product_ids": [product_id],
            "freeze_during_count": True,
        },
    )
    assert start_resp.status_code == 201, start_resp.text

    day_status = await client.get(
        "/api/v1/day/status", headers=headers, params={"location_id": tenant_a.location.id}
    )
    if day_status.json() is None:
        open_resp = await client.post(
            "/api/v1/day/open",
            headers={**headers, **idempotency_headers()},
            json={"location_id": tenant_a.location.id, "counted_amount_minor": 0},
        )
        assert open_resp.status_code == 201, open_resp.text

    sale_resp = await client.post(
        "/api/v1/sales",
        headers={**headers, **idempotency_headers()},
        json={
            "location_id": tenant_a.location.id,
            "lines": [{"product_id": product_id, "quantity": "1.0000"}],
            "payments": [{"method": "cash", "amount_minor": 118000}],
        },
    )
    assert sale_resp.status_code == 422
    assert "frozen" in sale_resp.text


@pytest.mark.asyncio
async def test_transfer_leaves_origin_immediately_and_arrives_on_receive(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    product_id = await _create_product(client, headers)
    await _receive_stock(client, headers, tenant_a, product_id, "20.0000")

    # There's no "create location" endpoint yet (Settings/locations
    # management is out of Phase 1 scope), so this test uses the
    # DB-seeded "Secondary" location created for the cross-tenant
    # isolation suite's transfer fixture (tests/conftest.py).
    async with tenant_scoped_session(tenant_a.business.id) as session:
        loc_result = await session.execute(
            select(Location).where(
                Location.business_id == tenant_a.business.id, Location.name == "Secondary"
            )
        )
        second_location_id = loc_result.scalar_one().id

    create_resp = await client.post(
        "/api/v1/stock/transfers",
        headers={**headers, **idempotency_headers()},
        json={
            "from_location_id": tenant_a.location.id,
            "to_location_id": second_location_id,
            "lines": [{"product_id": product_id, "quantity": "5.0000"}],
        },
    )
    assert create_resp.status_code == 201, create_resp.text
    transfer = create_resp.json()
    assert transfer["status"] == "in_transit"

    async with tenant_scoped_session(tenant_a.business.id) as session:
        origin_result = await session.execute(
            select(ProductLocation).where(
                ProductLocation.product_id == product_id,
                ProductLocation.location_id == tenant_a.location.id,
            )
        )
        assert origin_result.scalar_one().on_hand == 15  # 20 - 5, moved immediately

        dest_result = await session.execute(
            select(ProductLocation).where(
                ProductLocation.product_id == product_id,
                ProductLocation.location_id == second_location_id,
            )
        )
        assert dest_result.scalar_one_or_none() is None, "stock must not exist at destination yet"

    receive_resp = await client.post(
        f"/api/v1/stock/transfers/{transfer['id']}/receive",
        headers={**headers, **idempotency_headers()},
        json={"lines": [{"product_id": product_id, "quantity_received": "5.0000"}]},
    )
    assert receive_resp.status_code == 200, receive_resp.text
    received = receive_resp.json()
    assert received["status"] == "received"
    assert received["lines"][0]["discrepancy"] is False

    async with tenant_scoped_session(tenant_a.business.id) as session:
        dest_result = await session.execute(
            select(ProductLocation).where(
                ProductLocation.product_id == product_id,
                ProductLocation.location_id == second_location_id,
            )
        )
        assert dest_result.scalar_one().on_hand == 5


@pytest.mark.asyncio
async def test_transfer_receiving_a_different_quantity_flags_a_discrepancy(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    product_id = await _create_product(client, headers)
    await _receive_stock(client, headers, tenant_a, product_id, "20.0000")

    async with tenant_scoped_session(tenant_a.business.id) as session:
        loc_result = await session.execute(
            select(Location).where(
                Location.business_id == tenant_a.business.id, Location.name == "Secondary"
            )
        )
        second_location_id = loc_result.scalar_one().id

    create_resp = await client.post(
        "/api/v1/stock/transfers",
        headers={**headers, **idempotency_headers()},
        json={
            "from_location_id": tenant_a.location.id,
            "to_location_id": second_location_id,
            "lines": [{"product_id": product_id, "quantity": "10.0000"}],
        },
    )
    transfer_id = create_resp.json()["id"]

    receive_resp = await client.post(
        f"/api/v1/stock/transfers/{transfer_id}/receive",
        headers={**headers, **idempotency_headers()},
        json={"lines": [{"product_id": product_id, "quantity_received": "8.0000"}]},
    )
    assert receive_resp.status_code == 200, receive_resp.text
    received = receive_resp.json()
    assert received["status"] == "discrepancy"
    assert received["lines"][0]["discrepancy"] is True

    async with tenant_scoped_session(tenant_a.business.id) as session:
        dest_result = await session.execute(
            select(ProductLocation).where(
                ProductLocation.product_id == product_id,
                ProductLocation.location_id == second_location_id,
            )
        )
        # Exactly what was actually received, not what was sent.
        assert dest_result.scalar_one().on_hand == 8
