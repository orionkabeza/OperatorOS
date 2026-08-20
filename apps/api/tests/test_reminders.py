"""The reminder engine (spec D.6.5): schedule builder, due-step
selection, quiet-hours/frequency guardrails, template preview, and the
approval-mode digest send.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from operatoros_api.db import tenant_scoped_session
from operatoros_api.models.customers import CustomerBalance
from operatoros_api.models.reminders import ReminderLog
from operatoros_api.models.sales import Sale
from operatoros_api.reminders_engine import is_quiet_hours
from operatoros_api.tasks.reminders import run_reminder_tick_async
from tests.conftest import SeededTenant
from tests.helpers import auth_headers, idempotency_headers


def test_is_quiet_hours_wraps_midnight_correctly() -> None:
    """Pure unit test of the guardrail itself (D.6.5 default: 8pm-7am),
    independent of wall-clock time -- the digest/tick tests above
    deliberately disable this guardrail (quiet_hours_start ==
    quiet_hours_end) so THEIR pass/fail doesn't depend on what time it is
    when the suite runs; this test is what actually proves the wrapping
    math is correct."""
    start, end = 20, 7
    assert is_quiet_hours(datetime(2026, 1, 1, 21, 0, tzinfo=UTC), start, end) is True
    assert is_quiet_hours(datetime(2026, 1, 1, 3, 0, tzinfo=UTC), start, end) is True
    assert is_quiet_hours(datetime(2026, 1, 1, 19, 59, tzinfo=UTC), start, end) is False
    assert is_quiet_hours(datetime(2026, 1, 1, 7, 0, tzinfo=UTC), start, end) is False
    assert is_quiet_hours(datetime(2026, 1, 1, 12, 0, tzinfo=UTC), start, end) is False


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


async def _create_default_schedule(
    client: AsyncClient, headers: dict, *, approval_mode: bool = False
) -> str:
    # quiet_hours_start == quiet_hours_end (0, 0) deliberately disables the
    # quiet-hours guardrail entirely (is_quiet_hours's non-wrapping branch:
    # `0 <= hour < 0` is never true) -- these tests assert the DUE-STEP-
    # SELECTION and dedup/frequency logic, not quiet hours, and D.6.5's
    # real default (8pm-7am) would otherwise make the test's pass/fail
    # depend on what wall-clock time it happens to run at.
    resp = await client.post(
        "/api/v1/debt/reminder-schedules",
        headers={**headers, **idempotency_headers()},
        json={
            "name": "Default",
            "approval_mode": approval_mode,
            "quiet_hours_start": 0,
            "quiet_hours_end": 0,
            "max_per_customer_hours": 48,
            "steps": [
                {
                    "step_order": 1,
                    "offset_days": -3,
                    "label": "Friendly nudge",
                    "channel": "whatsapp",
                    "template_key": "nudge",
                    "templates": {"en": "Hi {customer}, your {amount} is due soon."},
                },
                {
                    "step_order": 2,
                    "offset_days": 0,
                    "label": "Due today",
                    "channel": "whatsapp",
                    "template_key": "due_today",
                    "templates": {"en": "Hi {customer}, {amount} is due today. Pay: {pay_link}"},
                },
                {
                    "step_order": 3,
                    "offset_days": 7,
                    "label": "Firm",
                    "channel": "whatsapp",
                    "template_key": "firm",
                    "templates": {
                        "en": "{customer}, you are {days_overdue} days overdue on {amount}."
                    },
                },
            ],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _create_credit_customer_and_sale(
    client: AsyncClient, headers: dict, tenant: SeededTenant, *, terms_days: int
) -> tuple[str, str]:
    await _open_day(client, headers, tenant)
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
            "location_id": tenant.location.id,
            "quantity": "5.0000",
            "unit_cost_minor": 50000,
        },
    )
    customer_resp = await client.post(
        "/api/v1/customers",
        headers={**headers, **idempotency_headers()},
        json={
            "name": "Reminder Customer",
            "phone": f"+2507{uuid.uuid4().int % 10**8:08d}",
            "terms_days": terms_days,
        },
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
            "location_id": tenant.location.id,
            "customer_id": customer_id,
            "lines": [{"product_id": product_id, "quantity": "1.0000"}],
            "payments": [{"method": "credit", "amount_minor": 118000}],
        },
    )
    assert sale_resp.status_code == 201, sale_resp.text
    return customer_id, sale_resp.json()["id"]


@pytest.mark.asyncio
async def test_a_second_default_schedule_is_rejected(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    """A plain SQL UniqueConstraint on a nullable column does NOT stop two
    rows both having customer_id=NULL (NULLs are never equal to each
    other) -- this asserts the deliberate partial-unique-index fix
    (migration 0015) actually holds, via the friendly 409 the endpoint
    checks for ahead of the DB constraint."""
    headers = await auth_headers(client, tenant_a)
    first = await _create_default_schedule(client, headers)
    assert first

    second_resp = await client.post(
        "/api/v1/debt/reminder-schedules",
        headers={**headers, **idempotency_headers()},
        json={"name": "A second default", "steps": []},
    )
    assert second_resp.status_code == 409, second_resp.text


@pytest.mark.asyncio
async def test_template_preview_renders_real_customer_data(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    customer_id, _sale_id = await _create_credit_customer_and_sale(
        client, headers, tenant_a, terms_days=0
    )

    resp = await client.post(
        "/api/v1/debt/reminder-schedules/preview",
        headers=headers,
        json={
            "customer_id": customer_id,
            "template": "Hi {customer}, you owe {amount}.",
            "language": "en",
        },
    )
    assert resp.status_code == 200, resp.text
    assert "Reminder Customer" in resp.json()["rendered"]
    assert "118000" in resp.json()["rendered"]


@pytest.mark.asyncio
async def test_digest_lists_a_due_step_and_send_writes_reminder_sent(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    await _create_default_schedule(client, headers, approval_mode=True)
    customer_id, sale_id = await _create_credit_customer_and_sale(
        client, headers, tenant_a, terms_days=0
    )

    # Force the invoice's due date solidly into the past so the "firm"
    # step (offset_days=7) is unambiguously due regardless of test speed.
    async with tenant_scoped_session(tenant_a.business.id) as session:
        sale = await session.get(Sale, sale_id)
        sale.due_date_at = datetime.now(UTC) - timedelta(days=10)
        await session.flush()

    digest_resp = await client.get("/api/v1/debt/reminder-digest", headers=headers)
    assert digest_resp.status_code == 200, digest_resp.text
    entries = digest_resp.json()
    entry = next(e for e in entries if e["customer_id"] == customer_id)
    assert entry["template_key"] == "firm"
    assert entry["days_overdue"] >= 7

    send_resp = await client.post(
        "/api/v1/debt/reminder-digest/send",
        headers={**headers, **idempotency_headers()},
        json={"customer_ids": [customer_id]},
    )
    assert send_resp.status_code == 200, send_resp.text
    assert send_resp.json()["sent"] == 1

    async with tenant_scoped_session(tenant_a.business.id) as session:
        log_result = await session.execute(
            select(ReminderLog).where(
                ReminderLog.business_id == tenant_a.business.id,
                ReminderLog.customer_id == customer_id,
                ReminderLog.source == "auto",
            )
        )
        log_row = log_result.scalar_one()
        assert log_row.template_key == "firm"
        assert log_row.channel == "whatsapp"

    # Sending again immediately must not re-send (already-sent-for-this-
    # invoice dedup).
    second_digest = await client.get("/api/v1/debt/reminder-digest", headers=headers)
    assert not any(e["customer_id"] == customer_id for e in second_digest.json())


@pytest.mark.asyncio
async def test_paused_schedule_produces_no_digest_entries(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    schedule_id = await _create_default_schedule(client, headers, approval_mode=True)
    customer_id, sale_id = await _create_credit_customer_and_sale(
        client, headers, tenant_a, terms_days=0
    )
    async with tenant_scoped_session(tenant_a.business.id) as session:
        sale = await session.get(Sale, sale_id)
        sale.due_date_at = datetime.now(UTC) - timedelta(days=10)
        await session.flush()

    pause_resp = await client.patch(
        f"/api/v1/debt/reminder-schedules/{schedule_id}",
        headers={**headers, **idempotency_headers()},
        json={"paused": True},
    )
    assert pause_resp.status_code == 200, pause_resp.text
    assert pause_resp.json()["paused"] is True

    digest_resp = await client.get("/api/v1/debt/reminder-digest", headers=headers)
    assert not any(e["customer_id"] == customer_id for e in digest_resp.json())


@pytest.mark.asyncio
async def test_unattended_tick_auto_sends_when_not_in_approval_mode(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    await _create_default_schedule(client, headers, approval_mode=False)
    customer_id, sale_id = await _create_credit_customer_and_sale(
        client, headers, tenant_a, terms_days=0
    )
    async with tenant_scoped_session(tenant_a.business.id) as session:
        sale = await session.get(Sale, sale_id)
        sale.due_date_at = datetime.now(UTC) - timedelta(days=10)
        await session.flush()

    sent_count = await run_reminder_tick_async()
    assert sent_count >= 1

    async with tenant_scoped_session(tenant_a.business.id) as session:
        log_result = await session.execute(
            select(ReminderLog).where(
                ReminderLog.business_id == tenant_a.business.id,
                ReminderLog.customer_id == customer_id,
                ReminderLog.source == "auto",
            )
        )
        assert log_result.scalar_one_or_none() is not None

        balance_result = await session.execute(
            select(CustomerBalance).where(CustomerBalance.customer_id == customer_id)
        )
        # The reminder itself must never move money -- only informs.
        assert balance_result.scalar_one().balance_minor == 118000
