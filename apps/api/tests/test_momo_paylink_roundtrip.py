"""The full sandbox loop, end to end (spec D.6.5/D.7.3, plan §0.5): a pay
link is opened, a payment is requested against the sandbox MoMo provider,
the sandbox "customer" approves (simulated settlement), and that
settlement lands through the exact same signed webhook path a real
provider would use, writing a real `PAYMENT_RECEIVED` that moves both the
Debt Book and the Cash Box.

`tasks/momo_settlement.py::_run_settlement` (the async core the Celery
task wraps) is called directly here rather than going through
`simulate_settlement.apply_async(...)` -- the same "call the async core
directly, in-process" pattern `tests/test_projection_audit_task.py`
already uses for the nightly audit task, since Celery's own scheduling
has nothing to do with what this test is proving (the settlement's
correctness once it fires).

`SandboxMomoProvider.request_payment`'s own `apply_async(...)` call is
monkeypatched to a no-op for this test: `celery_app.py` deliberately
keeps `task_always_eager = False` (a real deployment runs a real worker
against real Redis), and this test environment has no Redis broker
running -- calling the real `POST /api/pay/{token}/request-payment` endpoint
unpatched hangs for minutes retrying a connection that will never
succeed. No other test in this suite exercises `apply_async` against a
real broker either (`test_projection_audit_task.py` calls the task's
async core or the sync entrypoint directly, never through scheduling) --
this is consistent with that established pattern, not a new shortcut.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from operatoros_api.db import tenant_scoped_session
from operatoros_api.models.customers import CustomerBalance
from operatoros_api.models.momo import MomoTransaction
from operatoros_api.models.paylink import PayLink
from operatoros_api.models.projections import MoneyLocationBalance
from operatoros_api.tasks.momo_settlement import _run_settlement, simulate_settlement
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
async def test_pay_link_settles_via_the_sandbox_provider_and_moves_both_projections(
    client: AsyncClient, tenant_a: SeededTenant, monkeypatch: pytest.MonkeyPatch
) -> None:
    # See module docstring: no Redis broker runs in this test environment,
    # so the real `apply_async` scheduling call is patched to a no-op --
    # the settlement itself is fired manually below via `_run_settlement`.
    monkeypatch.setattr(simulate_settlement, "apply_async", lambda *args, **kwargs: None)
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
        json={"name": "Roundtrip Customer", "phone": f"+2507{uuid.uuid4().int % 10**8:08d}"},
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

    await client.post(
        "/api/v1/momo/connect",
        headers={**headers, **idempotency_headers()},
        json={"merchant_ref": "roundtrip-merchant"},
    )

    pay_link_resp = await client.post(
        f"/api/v1/debt/accounts/{customer_id}/pay-link",
        headers={**headers, **idempotency_headers()},
        json={"location_id": tenant_a.location.id},
    )
    assert pay_link_resp.status_code == 201, pay_link_resp.text
    token = pay_link_resp.json()["token"]
    assert pay_link_resp.json()["amount_minor"] == 118000

    async with tenant_scoped_session(tenant_a.business.id) as session:
        momo_before = await session.execute(
            select(MoneyLocationBalance).where(
                MoneyLocationBalance.location_id == tenant_a.location.id,
                MoneyLocationBalance.account_key == "momo",
            )
        )
        momo_before_row = momo_before.scalar_one_or_none()
        momo_before_balance = momo_before_row.balance_minor if momo_before_row else 0

    request_resp = await client.post(
        f"/api/pay/{token}/request-payment", json={"phone": "+250788999999"}
    )
    assert request_resp.status_code == 201, request_resp.text
    external_id = request_resp.json()["external_id"]

    # Fire the sandbox settlement's async core directly, in-process --
    # same payload shape and signature verification a real Celery-
    # scheduled call would produce, see module docstring.
    await _run_settlement(
        business_id=tenant_a.business.id,
        provider="sandbox_momo",
        external_id=external_id,
        phone="+250788999999",
        amount_minor=118000,
        reference=f"paylink-test-{uuid.uuid4().hex[:8]}",
    )

    async with tenant_scoped_session(tenant_a.business.id) as session:
        pay_link_result = await session.execute(
            select(PayLink).where(PayLink.business_id == tenant_a.business.id)
        )
        pay_link = pay_link_result.scalars().first()
        assert pay_link.status == "paid"
        assert pay_link.payment_event_id is not None

        balance_result = await session.execute(
            select(CustomerBalance).where(CustomerBalance.customer_id == customer_id)
        )
        assert balance_result.scalar_one().balance_minor == 0

        momo_after = await session.execute(
            select(MoneyLocationBalance).where(
                MoneyLocationBalance.location_id == tenant_a.location.id,
                MoneyLocationBalance.account_key == "momo",
            )
        )
        assert momo_after.scalar_one().balance_minor == momo_before_balance + 118000

        txn_result = await session.execute(
            select(MomoTransaction).where(
                MomoTransaction.business_id == tenant_a.business.id,
                MomoTransaction.external_id == external_id,
            )
        )
        txn = txn_result.scalar_one()
        assert txn.status == "matched"
        assert txn.matched_to_type == "pay_link"

    status_resp = await client.get(f"/api/pay/{token}/status")
    assert status_resp.json()["status"] == "paid"

    # The token is now dead even though it's still cryptographically valid.
    page_resp = await client.get(f"/api/pay/{token}")
    assert page_resp.status_code == 404
