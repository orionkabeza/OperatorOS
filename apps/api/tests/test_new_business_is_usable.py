from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient

from tests.conftest import SeededTenant
from tests.helpers import auth_headers, idempotency_headers

pytestmark = pytest.mark.asyncio


async def test_a_new_business_has_units(client: AsyncClient, tenant_a: SeededTenant) -> None:
    """Every product needs a base_unit_id, so a business with no units
    cannot hold stock at all. A freshly-created business used to have none:
    the CSV importer is forced to send `default_unit_id: ""`, the API
    rejects it 422, and a 40-row upload created 0 products."""
    headers = await auth_headers(client, tenant_a)
    resp = await client.get("/api/v1/products/units", headers=headers)
    assert resp.status_code == 200, resp.text
    units = resp.json()
    assert len(units) > 0, "a new business must start with at least one unit"
    assert "piece" in {u["name"] for u in units}


async def test_import_commit_works_on_a_brand_new_business(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    """The end-to-end shape of the failure that was reported: upload a
    product list to a business that has just been created."""
    headers = await auth_headers(client, tenant_a)
    units = (await client.get("/api/v1/products/units", headers=headers)).json()

    resp = await client.post(
        "/api/v1/products/import/commit",
        headers={**headers, **idempotency_headers()},
        json={
            "default_unit_id": units[0]["id"],
            "opening_location_id": tenant_a.location.id,
            "rows": [
                {
                    "row_number": 1,
                    "name": f"Cement 50kg {uuid.uuid4().hex[:6]}",
                    "sku": f"CEM-{uuid.uuid4().hex[:6]}",
                    "unit": "bag",
                    "cost_price_minor": 920000,
                    "selling_price_minor": 1050000,
                    "opening_quantity": "180",
                    "errors": [],
                    "is_duplicate": False,
                }
            ],
        },
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["created"] == 1
