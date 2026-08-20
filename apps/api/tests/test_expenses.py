"""Expenses (spec D.7.4): below-threshold auto-post, above-threshold
manager-approval gate, rejection, receipt upload, and recurring expenses.
"""

from __future__ import annotations

import io
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from operatoros_api.db import tenant_scoped_session
from operatoros_api.models.projections import MoneyLocationBalance
from operatoros_api.seed import create_user
from tests.conftest import SeededTenant
from tests.helpers import auth_headers, idempotency_headers


@pytest.mark.asyncio
async def test_below_threshold_expense_posts_immediately_and_moves_money(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)

    async with tenant_scoped_session(tenant_a.business.id) as session:
        result = await session.execute(
            select(MoneyLocationBalance).where(
                MoneyLocationBalance.location_id == tenant_a.location.id,
                MoneyLocationBalance.account_key == "till",
            )
        )
        row = result.scalar_one_or_none()
        till_before = row.balance_minor if row else 0

    resp = await client.post(
        "/api/v1/expenses",
        headers={**headers, **idempotency_headers()},
        json={
            "location_id": tenant_a.location.id,
            "amount_minor": 100000,
            "category": "Airtime",
            "money_location": "till",
            "expense_date": "2026-08-20",
            "note": "Airtime for the shop phone",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "posted"

    async with tenant_scoped_session(tenant_a.business.id) as session:
        result = await session.execute(
            select(MoneyLocationBalance).where(
                MoneyLocationBalance.location_id == tenant_a.location.id,
                MoneyLocationBalance.account_key == "till",
            )
        )
        assert result.scalar_one().balance_minor == till_before - 100000


@pytest.mark.asyncio
async def test_above_threshold_expense_requires_manager_approval(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)

    create_resp = await client.post(
        "/api/v1/expenses",
        headers={**headers, **idempotency_headers()},
        json={
            "location_id": tenant_a.location.id,
            "amount_minor": 900000,
            "category": "Rent",
            "money_location": "bank",
            "expense_date": "2026-08-20",
        },
    )
    assert create_resp.status_code == 201, create_resp.text
    expense = create_resp.json()
    assert expense["status"] == "pending_approval"
    expense_id = expense["id"]

    async with tenant_scoped_session(tenant_a.business.id) as session:
        result = await session.execute(
            select(MoneyLocationBalance).where(
                MoneyLocationBalance.location_id == tenant_a.location.id,
                MoneyLocationBalance.account_key == "bank",
            )
        )
        assert result.scalar_one_or_none() is None, "money must not move before approval"

    approve_resp = await client.post(
        f"/api/v1/expenses/{expense_id}/approve",
        headers={**headers, **idempotency_headers()},
    )
    assert approve_resp.status_code == 200, approve_resp.text
    assert approve_resp.json()["status"] == "posted"
    assert approve_resp.json()["approved_by_user_id"] == tenant_a.owner.id

    async with tenant_scoped_session(tenant_a.business.id) as session:
        result = await session.execute(
            select(MoneyLocationBalance).where(
                MoneyLocationBalance.location_id == tenant_a.location.id,
                MoneyLocationBalance.account_key == "bank",
            )
        )
        assert result.scalar_one().balance_minor == -900000


@pytest.mark.asyncio
async def test_cashier_cannot_approve_their_own_above_threshold_expense(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
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

    create_resp = await client.post(
        "/api/v1/expenses",
        headers={**cashier_headers, **idempotency_headers()},
        json={
            "location_id": tenant_a.location.id,
            "amount_minor": 900000,
            "category": "Repairs",
            "money_location": "till",
            "expense_date": "2026-08-20",
        },
    )
    assert create_resp.status_code == 201, create_resp.text
    expense_id = create_resp.json()["id"]

    approve_resp = await client.post(
        f"/api/v1/expenses/{expense_id}/approve",
        headers={**cashier_headers, **idempotency_headers()},
    )
    assert approve_resp.status_code == 403, approve_resp.text


@pytest.mark.asyncio
async def test_rejected_expense_never_posts_or_moves_money(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    create_resp = await client.post(
        "/api/v1/expenses",
        headers={**headers, **idempotency_headers()},
        json={
            "location_id": tenant_a.location.id,
            "amount_minor": 750000,
            "category": "Other",
            "money_location": "till",
            "expense_date": "2026-08-20",
        },
    )
    expense_id = create_resp.json()["id"]

    reject_resp = await client.post(
        f"/api/v1/expenses/{expense_id}/reject",
        headers={**headers, **idempotency_headers()},
        json={"reason": "Not a legitimate business expense."},
    )
    assert reject_resp.status_code == 200, reject_resp.text
    assert reject_resp.json()["status"] == "rejected"

    get_resp = await client.get(f"/api/v1/expenses/{expense_id}", headers=headers)
    assert get_resp.json()["status"] == "rejected"

    # A rejected expense cannot later be approved.
    approve_resp = await client.post(
        f"/api/v1/expenses/{expense_id}/approve",
        headers={**headers, **idempotency_headers()},
    )
    assert approve_resp.status_code == 409


@pytest.mark.asyncio
async def test_receipt_upload_returns_a_real_stored_url_and_null_ocr(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    files = {"file": ("receipt.jpg", io.BytesIO(b"fake-jpeg-bytes"), "image/jpeg")}
    resp = await client.post("/api/v1/expenses/receipt-upload", headers=headers, files=files)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["receipt_photo_url"].startswith(f"/uploads/{tenant_a.business.id}/")
    assert body["ocr_prefill"] is None


@pytest.mark.asyncio
async def test_recurring_expense_crud(client: AsyncClient, tenant_a: SeededTenant) -> None:
    headers = await auth_headers(client, tenant_a)
    create_resp = await client.post(
        "/api/v1/expenses/recurring",
        headers={**headers, **idempotency_headers()},
        json={
            "location_id": tenant_a.location.id,
            "amount_minor": 300000,
            "category": "Rent",
            "money_location": "bank",
            "interval": "monthly",
            "next_run_date": "2026-09-01",
        },
    )
    assert create_resp.status_code == 201, create_resp.text
    recurring_id = create_resp.json()["id"]
    assert create_resp.json()["active"] is True

    update_resp = await client.patch(
        f"/api/v1/expenses/recurring/{recurring_id}",
        headers={**headers, **idempotency_headers()},
        json={"active": False},
    )
    assert update_resp.status_code == 200, update_resp.text
    assert update_resp.json()["active"] is False

    list_resp = await client.get("/api/v1/expenses/recurring/list", headers=headers)
    assert list_resp.status_code == 200
    assert any(r["id"] == recurring_id for r in list_resp.json())
