"""Idempotency-Key handling (spec G.1): every mutating endpoint stores the
key + response for 24h and replays the exact original response on a
repeat. The concurrency test below is the one the brief calls out
specifically: fire the same request twice AT THE SAME TIME and assert only
one event was written -- relying on Postgres's real locking behaviour for
`INSERT ... ON CONFLICT` (idempotency_service.py's docstring explains why
that's sufficient with no extra application-level locking).
"""

from __future__ import annotations

import asyncio
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from operatoros_api.db import tenant_scoped_session
from operatoros_api.models.events import Event
from tests.conftest import SeededTenant
from tests.helpers import auth_headers


async def _count_events(tenant: SeededTenant, event_type: str) -> int:
    async with tenant_scoped_session(tenant.business.id) as session:
        result = await session.execute(
            select(Event).where(Event.business_id == tenant.business.id, Event.type == event_type)
        )
        return len(result.all())


@pytest.mark.asyncio
async def test_concurrent_duplicate_requests_write_exactly_one_event(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    key = f"concurrent-{uuid.uuid4().hex}"
    body = {
        "type": "EXPENSE_RECORDED",
        "location_id": tenant_a.location.id,
        "payload": {"amount_minor": 42000, "category": "Repairs", "money_location": "till"},
    }

    async def fire():
        return await client.post(
            "/api/v1/events", headers={**headers, "Idempotency-Key": key}, json=body
        )

    resp1, resp2 = await asyncio.gather(fire(), fire())

    assert resp1.status_code == 201, resp1.text
    assert resp2.status_code == 201, resp2.text
    assert resp1.json() == resp2.json(), "the two responses must be byte-for-byte the same event"

    count = await _count_events(tenant_a, "EXPENSE_RECORDED")
    assert count == 1, f"expected exactly one event to be written, found {count}"


@pytest.mark.asyncio
async def test_sequential_replay_with_same_key_returns_the_original_response(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    key = f"sequential-{uuid.uuid4().hex}"
    body = {
        "type": "EXPENSE_RECORDED",
        "location_id": tenant_a.location.id,
        "payload": {"amount_minor": 15000, "category": "Transport", "money_location": "till"},
    }

    first = await client.post(
        "/api/v1/events", headers={**headers, "Idempotency-Key": key}, json=body
    )
    second = await client.post(
        "/api/v1/events", headers={**headers, "Idempotency-Key": key}, json=body
    )

    assert first.status_code == second.status_code == 201
    assert first.json() == second.json()
    assert await _count_events(tenant_a, "EXPENSE_RECORDED") == 1


@pytest.mark.asyncio
async def test_different_idempotency_keys_are_not_deduplicated(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    body = {
        "type": "EXPENSE_RECORDED",
        "location_id": tenant_a.location.id,
        "payload": {"amount_minor": 9000, "category": "Airtime", "money_location": "till"},
    }

    r1 = await client.post(
        "/api/v1/events",
        headers={**headers, "Idempotency-Key": f"k1-{uuid.uuid4().hex}"},
        json=body,
    )
    r2 = await client.post(
        "/api/v1/events",
        headers={**headers, "Idempotency-Key": f"k2-{uuid.uuid4().hex}"},
        json=body,
    )
    assert r1.status_code == r2.status_code == 201
    assert r1.json()["id"] != r2.json()["id"]
    assert await _count_events(tenant_a, "EXPENSE_RECORDED") == 2


@pytest.mark.asyncio
async def test_reusing_a_key_with_a_different_body_is_a_conflict(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    key = f"conflict-{uuid.uuid4().hex}"
    first_body = {
        "type": "EXPENSE_RECORDED",
        "location_id": tenant_a.location.id,
        "payload": {"amount_minor": 1000, "category": "Rent", "money_location": "till"},
    }
    second_body = {
        "type": "EXPENSE_RECORDED",
        "location_id": tenant_a.location.id,
        "payload": {"amount_minor": 2000, "category": "Rent", "money_location": "till"},
    }

    first = await client.post(
        "/api/v1/events", headers={**headers, "Idempotency-Key": key}, json=first_body
    )
    assert first.status_code == 201

    second = await client.post(
        "/api/v1/events", headers={**headers, "Idempotency-Key": key}, json=second_body
    )
    assert second.status_code == 409


@pytest.mark.asyncio
async def test_missing_idempotency_key_is_rejected(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    resp = await client.post(
        "/api/v1/events",
        headers=headers,
        json={
            "type": "EXPENSE_RECORDED",
            "location_id": tenant_a.location.id,
            "payload": {"amount_minor": 1000, "category": "Rent", "money_location": "till"},
        },
    )
    assert resp.status_code == 400
