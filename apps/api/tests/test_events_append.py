"""The typed event registry + append API (spec E.1/E.2): the envelope and
payload are validated against the registry before anything is written;
unknown types, missing fields, and extra fields are all rejected.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient

from operatoros_api.db import tenant_scoped_session
from operatoros_api.ledger import EnvelopeValidationError, EventEnvelopeInput, append_event
from tests.conftest import SeededTenant
from tests.helpers import auth_headers, idempotency_headers


@pytest.mark.asyncio
async def test_append_valid_event_via_http(client: AsyncClient, tenant_a: SeededTenant) -> None:
    headers = await auth_headers(client, tenant_a)
    resp = await client.post(
        "/api/v1/events",
        headers={**headers, **idempotency_headers()},
        json={
            "type": "EXPENSE_RECORDED",
            "location_id": tenant_a.location.id,
            "payload": {
                "amount_minor": 500000,
                "category": "Rent",
                "money_location": "till",
            },
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["type"] == "EXPENSE_RECORDED"
    assert body["business_id"] == tenant_a.business.id
    assert body["schema_version"] == 1


@pytest.mark.asyncio
async def test_append_unknown_event_type_is_rejected(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    resp = await client.post(
        "/api/v1/events",
        headers={**headers, **idempotency_headers()},
        json={"type": "SOMETHING_MADE_UP", "payload": {}},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_append_payload_missing_required_field_is_rejected(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    resp = await client.post(
        "/api/v1/events",
        headers={**headers, **idempotency_headers()},
        json={
            "type": "EXPENSE_RECORDED",
            "location_id": tenant_a.location.id,
            "payload": {"category": "Rent"},  # missing amount_minor, money_location
        },
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_append_payload_extra_field_is_rejected(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    resp = await client.post(
        "/api/v1/events",
        headers={**headers, **idempotency_headers()},
        json={
            "type": "EXPENSE_RECORDED",
            "location_id": tenant_a.location.id,
            "payload": {
                "amount_minor": 1000,
                "category": "Rent",
                "money_location": "till",
                "totally_unexpected_field": "nope",
            },
        },
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_ledger_rejects_invalid_actor_source(tenant_a: SeededTenant) -> None:
    async with tenant_scoped_session(tenant_a.business.id) as session:
        with pytest.raises(EnvelopeValidationError):
            await append_event(
                session,
                EventEnvelopeInput(
                    business_id=tenant_a.business.id,
                    type="EXPENSE_RECORDED",
                    payload={"amount_minor": 100, "category": "Rent", "money_location": "till"},
                    actor_user_id=tenant_a.owner.id,
                    actor_source="carrier-pigeon",
                    location_id=tenant_a.location.id,
                    correlation_id=str(uuid.uuid4()),
                ),
            )


@pytest.mark.asyncio
async def test_ledger_stamps_schema_version_and_correlation_id(tenant_a: SeededTenant) -> None:
    async with tenant_scoped_session(tenant_a.business.id) as session:
        event = await append_event(
            session,
            EventEnvelopeInput(
                business_id=tenant_a.business.id,
                type="PRODUCT_CREATED",
                payload={"product_id": str(uuid.uuid4()), "name": "Cement 50kg"},
                actor_user_id=tenant_a.owner.id,
                actor_source="web",
            ),
        )
    assert event.schema_version == 1
    assert event.correlation_id  # auto-generated when not supplied
