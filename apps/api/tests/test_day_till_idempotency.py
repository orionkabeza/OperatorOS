"""Idempotency on `day`/`till` (plan §3: "every mutating endpoint (sales,
stock, day, till) requires the Idempotency-Key header ... critical here
because the Counter must survive a flaky connection without double-
selling") -- the same concurrent-double-submit proof as
tests/test_sales_atomicity.py, applied to day-open and till-open.

`tenant_a` already seeds one open DaySession/TillSession directly
(tests/conftest.py, for the cross-tenant isolation suite's resource seeds)
-- these tests close that seeded session first so a fresh open/close
through the real endpoint is what's actually being raced.
"""

from __future__ import annotations

import asyncio
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from operatoros_api.db import tenant_scoped_session
from operatoros_api.models.day_till import DaySession, TillSession
from tests.conftest import SeededTenant
from tests.helpers import auth_headers


async def _close_seeded_day(tenant: SeededTenant) -> None:
    """Closes with `closing_counted_amount_minor = 0` so the next `day/open`
    call's expected-vs-counted variance check (api/routers/day.py) is zero
    when the test itself opens with `counted_amount_minor: 0` -- these
    tests are about idempotency, not variance handling, so avoiding that
    check entirely keeps them focused."""
    async with tenant_scoped_session(tenant.business.id) as session:
        day = await session.get(DaySession, tenant.day_session.id)
        day.status = "closed"
        day.closing_counted_amount_minor = 0
        till = await session.get(TillSession, tenant.till_session.id)
        till.status = "closed"


@pytest.mark.asyncio
async def test_concurrent_double_submit_day_open_opens_exactly_once(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    await _close_seeded_day(tenant_a)
    headers = await auth_headers(client, tenant_a)
    idem_key = f"day-open-{uuid.uuid4().hex}"
    body = {"location_id": tenant_a.location.id, "counted_amount_minor": 0}

    async def fire():
        return await client.post(
            "/api/v1/day/open", headers={**headers, "Idempotency-Key": idem_key}, json=body
        )

    resp1, resp2 = await asyncio.gather(fire(), fire())
    assert resp1.status_code == 201, resp1.text
    assert resp2.status_code == 201, resp2.text
    assert resp1.json() == resp2.json()

    async with tenant_scoped_session(tenant_a.business.id) as session:
        result = await session.execute(
            select(DaySession).where(
                DaySession.location_id == tenant_a.location.id, DaySession.status == "open"
            )
        )
        open_days = result.scalars().all()
        assert len(open_days) == 1, "exactly one open day session must exist, not two"


@pytest.mark.asyncio
async def test_sequential_replay_day_open_does_not_reopen(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    await _close_seeded_day(tenant_a)
    headers = await auth_headers(client, tenant_a)
    idem_key = f"day-open-seq-{uuid.uuid4().hex}"
    body = {"location_id": tenant_a.location.id, "counted_amount_minor": 0}

    first = await client.post(
        "/api/v1/day/open", headers={**headers, "Idempotency-Key": idem_key}, json=body
    )
    second = await client.post(
        "/api/v1/day/open", headers={**headers, "Idempotency-Key": idem_key}, json=body
    )
    assert first.status_code == second.status_code == 201
    assert first.json() == second.json()


@pytest.mark.asyncio
async def test_concurrent_double_submit_till_open_opens_exactly_once(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    # tenant_a's seeded day session stays open for this one -- till/open
    # requires an open day.
    headers = await auth_headers(client, tenant_a)
    idem_key = f"till-open-{uuid.uuid4().hex}"
    body = {"location_id": tenant_a.location.id, "opening_float_minor": 10000}

    async def fire():
        return await client.post(
            "/api/v1/till/open", headers={**headers, "Idempotency-Key": idem_key}, json=body
        )

    resp1, resp2 = await asyncio.gather(fire(), fire())
    assert resp1.status_code == 201, resp1.text
    assert resp2.status_code == 201, resp2.text
    assert resp1.json() == resp2.json()

    async with tenant_scoped_session(tenant_a.business.id) as session:
        result = await session.execute(
            select(TillSession).where(
                TillSession.cashier_user_id == tenant_a.owner.id,
                TillSession.opening_float_minor == 10000,
            )
        )
        assert len(result.all()) == 1, "exactly one till session must have been opened, not two"


@pytest.mark.asyncio
async def test_reusing_day_open_key_with_a_different_body_is_a_conflict(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    await _close_seeded_day(tenant_a)
    headers = await auth_headers(client, tenant_a)
    idem_key = f"day-open-conflict-{uuid.uuid4().hex}"

    first = await client.post(
        "/api/v1/day/open",
        headers={**headers, "Idempotency-Key": idem_key},
        json={"location_id": tenant_a.location.id, "counted_amount_minor": 0},
    )
    assert first.status_code == 201, first.text

    second = await client.post(
        "/api/v1/day/open",
        headers={**headers, "Idempotency-Key": idem_key},
        json={
            "location_id": tenant_a.location.id,
            "counted_amount_minor": 5000,
            "variance_reason": "till was short",
        },
    )
    assert second.status_code == 409
