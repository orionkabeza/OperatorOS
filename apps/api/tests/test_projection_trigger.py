"""The projection-write-rejection trigger (spec E.3): only the projection
framework (projections/framework.py::apply_projections, which brackets its
writes with `app.projection_writer = true` for the duration of the call)
may write to `money_location_balance`. A raw UPDATE/INSERT/DELETE against
it from anywhere else -- even using the ordinary `operatoros_app` role,
even inside a tenant-scoped session -- must be rejected by the
`reject_direct_projection_write()` trigger.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from operatoros_api.db import tenant_scoped_session
from operatoros_api.ledger import EventEnvelopeInput, append_event
from operatoros_api.models.projections import MoneyLocationBalance
from tests.conftest import SeededTenant


@pytest.mark.asyncio
async def test_raw_update_against_projection_table_is_rejected(tenant_a: SeededTenant) -> None:
    # Seed a real row the "normal" way first (through the framework) so
    # there's something plausible to attack.
    async with tenant_scoped_session(tenant_a.business.id) as session:
        await append_event(
            session,
            EventEnvelopeInput(
                business_id=tenant_a.business.id,
                type="EXPENSE_RECORDED",
                payload={"amount_minor": 1000, "category": "Rent", "money_location": "till"},
                actor_user_id=tenant_a.owner.id,
                actor_source="api",
                location_id=tenant_a.location.id,
            ),
        )

    with pytest.raises(DBAPIError, match="Direct writes"):
        async with tenant_scoped_session(tenant_a.business.id) as session:
            await session.execute(
                text(
                    "UPDATE money_location_balance SET balance_minor = 999999999 "
                    "WHERE business_id = :bid"
                ),
                {"bid": tenant_a.business.id},
            )


@pytest.mark.asyncio
async def test_raw_insert_against_projection_table_is_rejected(tenant_a: SeededTenant) -> None:
    with pytest.raises(DBAPIError, match="Direct writes"):
        async with tenant_scoped_session(tenant_a.business.id) as session:
            session.add(
                MoneyLocationBalance(
                    business_id=tenant_a.business.id,
                    location_id=tenant_a.location.id,
                    account_key="bank",
                    balance_minor=123456,
                )
            )
            await session.flush()


@pytest.mark.asyncio
async def test_raw_delete_against_projection_table_is_rejected(tenant_a: SeededTenant) -> None:
    async with tenant_scoped_session(tenant_a.business.id) as session:
        await append_event(
            session,
            EventEnvelopeInput(
                business_id=tenant_a.business.id,
                type="EXPENSE_RECORDED",
                payload={"amount_minor": 500, "category": "Airtime", "money_location": "till"},
                actor_user_id=tenant_a.owner.id,
                actor_source="api",
                location_id=tenant_a.location.id,
            ),
        )

    with pytest.raises(DBAPIError, match="Direct writes"):
        async with tenant_scoped_session(tenant_a.business.id) as session:
            await session.execute(
                text("DELETE FROM money_location_balance WHERE business_id = :bid"),
                {"bid": tenant_a.business.id},
            )


@pytest.mark.asyncio
async def test_the_projection_framework_itself_can_still_write(tenant_a: SeededTenant) -> None:
    """Sanity check that the trigger isn't simply broken/blocking
    everything: the normal, in-transaction path used by every other test
    in this file continues to work."""
    async with tenant_scoped_session(tenant_a.business.id) as session:
        await append_event(
            session,
            EventEnvelopeInput(
                business_id=tenant_a.business.id,
                type="MONEY_TRANSFERRED",
                payload={
                    "from_money_location": "till",
                    "to_money_location": "bank",
                    "amount_minor": 200000,
                },
                actor_user_id=tenant_a.owner.id,
                actor_source="api",
                location_id=tenant_a.location.id,
                correlation_id=str(uuid.uuid4()),
            ),
        )
