"""CSV/XLSX product import (spec D.2 Step 3, plan §0.6/§3): validate ->
preview (per-row errors, duplicate detection) -> commit, plus the
corrected-template CSV re-download for failed rows.
"""

from __future__ import annotations

import io

import openpyxl
import pytest
from httpx import AsyncClient
from sqlalchemy import select

from operatoros_api.db import tenant_scoped_session
from operatoros_api.models.catalog import Product, ProductLocation, Unit
from tests.conftest import SeededTenant
from tests.helpers import auth_headers, idempotency_headers

CSV_BODY = (
    "name,sku,barcode,category,unit,cost_price,selling_price,opening_quantity\n"
    "Cement 50kg,CEM-50,,Building,bag,7000,9000,25\n"
    "Rebar 12mm,REB-12,,Steel,piece,3200,4500,\n"
    "Bad Row,,,,,notanumber,5000,\n"
    "Cement 50kg,CEM-50-DUP,,Building,bag,7000,9000,10\n"
)


async def _get_unit_id(tenant: SeededTenant) -> str:
    async with tenant_scoped_session(tenant.business.id) as session:
        result = await session.execute(select(Unit).where(Unit.business_id == tenant.business.id))
        return result.scalars().first().id


@pytest.mark.asyncio
async def test_csv_preview_validates_and_flags_duplicates(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    files = {"file": ("products.csv", CSV_BODY.encode(), "text/csv")}
    resp = await client.post("/api/v1/products/import/preview", headers=headers, files=files)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["total_rows"] == 4
    assert body["valid_rows"] == 2
    assert body["error_rows"] == 2
    assert body["duplicate_rows"] == 1

    rows_by_name = {row["sku"]: row for row in body["preview"] if row["sku"]}
    assert rows_by_name["CEM-50"]["errors"] == []
    assert rows_by_name["CEM-50"]["is_duplicate"] is False
    assert rows_by_name["CEM-50-DUP"]["is_duplicate"] is True

    bad_row = next(row for row in body["preview"] if row["name"] == "Bad Row")
    assert any("cost_price" in e for e in bad_row["errors"])


@pytest.mark.asyncio
async def test_csv_commit_creates_valid_rows_and_skips_bad_or_duplicate_rows(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    unit_id = await _get_unit_id(tenant_a)

    files = {"file": ("products.csv", CSV_BODY.encode(), "text/csv")}
    preview_resp = await client.post(
        "/api/v1/products/import/preview", headers=headers, files=files
    )
    preview = preview_resp.json()["preview"]

    commit_resp = await client.post(
        "/api/v1/products/import/commit",
        headers={**headers, **idempotency_headers()},
        json={
            "rows": preview,
            "default_unit_id": unit_id,
            "opening_location_id": tenant_a.location.id,
        },
    )
    assert commit_resp.status_code == 201, commit_resp.text
    result = commit_resp.json()
    assert result["created"] == 2
    assert result["skipped"] == 2

    async with tenant_scoped_session(tenant_a.business.id) as session:
        cement_result = await session.execute(
            select(Product).where(
                Product.business_id == tenant_a.business.id, Product.sku == "CEM-50"
            )
        )
        cement = cement_result.scalar_one()
        assert cement.cost_price_minor == 700000
        assert cement.selling_price_minor == 900000

        stock_result = await session.execute(
            select(ProductLocation).where(ProductLocation.product_id == cement.id)
        )
        assert stock_result.scalar_one().on_hand == 25

        dup_result = await session.execute(
            select(Product).where(
                Product.business_id == tenant_a.business.id, Product.sku == "CEM-50-DUP"
            )
        )
        assert dup_result.first() is None, "the duplicate-named row must not have been created"


@pytest.mark.asyncio
async def test_csv_commit_is_idempotent(client: AsyncClient, tenant_a: SeededTenant) -> None:
    headers = await auth_headers(client, tenant_a)
    unit_id = await _get_unit_id(tenant_a)
    files = {"file": ("products.csv", CSV_BODY.encode(), "text/csv")}
    preview_resp = await client.post(
        "/api/v1/products/import/preview", headers=headers, files=files
    )
    preview = preview_resp.json()["preview"]

    body = {
        "rows": preview,
        "default_unit_id": unit_id,
        "opening_location_id": tenant_a.location.id,
    }
    idem = idempotency_headers()

    first = await client.post(
        "/api/v1/products/import/commit", headers={**headers, **idem}, json=body
    )
    second = await client.post(
        "/api/v1/products/import/commit", headers={**headers, **idem}, json=body
    )
    assert first.status_code == second.status_code == 201
    assert first.json() == second.json()

    async with tenant_scoped_session(tenant_a.business.id) as session:
        result = await session.execute(
            select(Product).where(
                Product.business_id == tenant_a.business.id, Product.sku == "CEM-50"
            )
        )
        assert len(result.all()) == 1, "a replayed commit must not create the product twice"


@pytest.mark.asyncio
async def test_corrected_template_csv_contains_only_failed_rows(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    files = {"file": ("products.csv", CSV_BODY.encode(), "text/csv")}
    preview_resp = await client.post(
        "/api/v1/products/import/preview", headers=headers, files=files
    )
    preview = preview_resp.json()["preview"]

    resp = await client.post(
        "/api/v1/products/import/corrected-template", headers=headers, json={"rows": preview}
    )
    assert resp.status_code == 200, resp.text
    csv_text = resp.json()["csv"]
    assert "CEM-50-DUP" in csv_text  # the duplicate row
    assert "Bad Row" in csv_text  # the row with an invalid price
    assert csv_text.count("\n") <= 4  # header + 2 failed rows (+ trailing newline slack)
    # A cleanly-valid row must not appear in the corrected template.
    assert "REB-12" not in csv_text


@pytest.mark.asyncio
async def test_xlsx_import_is_parsed(client: AsyncClient, tenant_a: SeededTenant) -> None:
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.append(
        [
            "name",
            "sku",
            "barcode",
            "category",
            "unit",
            "cost_price",
            "selling_price",
            "opening_quantity",
        ]
    )
    sheet.append(["Paint 4L", "PNT-4", "", "Paint", "tin", "12000", "16000", "8"])
    buffer = io.BytesIO()
    workbook.save(buffer)
    buffer.seek(0)

    headers = await auth_headers(client, tenant_a)
    files = {
        "file": (
            "products.xlsx",
            buffer.read(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    }
    resp = await client.post("/api/v1/products/import/preview", headers=headers, files=files)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total_rows"] == 1
    assert body["valid_rows"] == 1
    assert body["preview"][0]["sku"] == "PNT-4"
    assert body["preview"][0]["cost_price_minor"] == 1200000


@pytest.mark.asyncio
async def test_oversized_upload_is_rejected(client: AsyncClient, tenant_a: SeededTenant) -> None:
    headers = await auth_headers(client, tenant_a)
    huge_body = b"name,sku\n" + b"x" * (6 * 1024 * 1024)
    files = {"file": ("huge.csv", huge_body, "text/csv")}
    resp = await client.post("/api/v1/products/import/preview", headers=headers, files=files)
    assert resp.status_code == 422
    assert "limit" in resp.text


@pytest.mark.asyncio
async def test_corrected_template_csv_escapes_formula_injection(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    """OWASP CSV Injection: a product name/sku that starts with =, +, -,
    or @ must not survive into the corrected-template CSV as a live
    formula trigger when the business reopens it in Excel/Sheets."""
    malicious_csv = (
        "name,sku,barcode,category,unit,cost_price,selling_price,opening_quantity\n"
        "=cmd|'/c calc'!A1,+SKU1,,-Category,@unit,1000,2000,not-a-number\n"
    )
    headers = await auth_headers(client, tenant_a)
    files = {"file": ("products.csv", malicious_csv.encode(), "text/csv")}
    preview_resp = await client.post(
        "/api/v1/products/import/preview", headers=headers, files=files
    )
    preview = preview_resp.json()["preview"]
    assert preview[0]["errors"], "row should have failed validation (opening_quantity)"

    resp = await client.post(
        "/api/v1/products/import/corrected-template", headers=headers, json={"rows": preview}
    )
    assert resp.status_code == 200, resp.text
    csv_text = resp.json()["csv"]

    for line in csv_text.splitlines()[1:]:
        for cell in line.split(","):
            unquoted = cell.strip('"')
            if unquoted:
                assert unquoted[0] not in (
                    "=",
                    "+",
                    "-",
                    "@",
                    "\t",
                    "\r",
                ), f"field {cell!r} was not neutralized against formula injection"
    assert "'=cmd" in csv_text
    assert "'+SKU1" in csv_text
