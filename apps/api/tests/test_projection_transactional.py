"""Projections update in the SAME transaction as the event append (spec
E.3) -- not eventually. Proven two ways: (1) a successful append is
immediately reflected in the projection with no separate step, and (2) a
failure partway through the request rolls back BOTH the event and the
projection update together, so a half-applied state (event recorded, money
not moved, or vice versa) can never be observed.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from operatoros_api.db import tenant_scoped_session
from operatoros_api.ledger import EventEnvelopeInput, append_event
from operatoros_api.models.events import Event
from operatoros_api.models.projections import MoneyLocationBalance
from tests.conftest import SeededTenant


async def _balance(tenant: SeededTenant, account_key: str) -> int:
    async with tenant_scoped_session(tenant.business.id) as session:
        result = await session.execute(
            select(MoneyLocationBalance).where(
                MoneyLocationBalance.location_id == tenant.location.id,
                MoneyLocationBalance.account_key == account_key,
            )
        )
        row = result.scalar_one_or_none()
        return row.balance_minor if row else 0


@pytest.mark.asyncio
async def test_projection_reflects_the_event_in_the_same_transaction(tenant_a: SeededTenant) -> None:
    before = await _balance(tenant_a, "till")

    async with tenant_scoped_session(tenant_a.business.id) as session:
        await append_event(
            session,
            EventEnvelopeInput(
                business_id=tenant_a.business.id,
                type="EXPENSE_RECORDED",
                payload={"amount_minor": 750000, "category": "Rent", "money_location": "till"},
                actor_user_id=tenant_a.owner.id,
                actor_source="api",
                location_id=tenant_a.location.id,
            ),
        )
        # Read it back INSIDE the same still-open transaction -- this is
        # what "same transaction" actually buys: no second round trip, no
        # window where the event exists but the balance hasn't moved yet.
        result = await session.execute(
            select(MoneyLocationBalance).where(
                MoneyLocationBalance.location_id == tenant_a.location.id,
                MoneyLocationBalance.account_key == "till",
            )
        )
        row = result.scalar_one()
        assert row.balance_minor == before - 750000

    after = await _balance(tenant_a, "till")
    assert after == before - 750000


@pytest.mark.asyncio
async def test_a_failure_after_append_rolls_back_the_event_and_the_projection_together(
    tenant_a: SeededTenant,
) -> None:
    before_balance = await _balance(tenant_a, "till")
    async with tenant_scoped_session(tenant_a.business.id) as session:
        before_count_result = await session.execute(
            select(Event).where(
                Event.business_id == tenant_a.business.id, Event.type == "EXPENSE_RECORDED"
            )
        )
        before_count = len(before_count_result.all())

    with pytest.raises(RuntimeError):
        async with tenant_scoped_session(tenant_a.business.id) as session:
            await append_event(
                session,
                EventEnvelopeInput(
                    business_id=tenant_a.business.id,
                    type="EXPENSE_RECORDED",
                    payload={
                        "amount_minor": 999000,
                        "category": "Repairs",
                        "money_location": "till",
                    },
                    actor_user_id=tenant_a.owner.id,
                    actor_source="api",
                    location_id=tenant_a.location.id,
                ),
            )
            # Simulate a downstream failure in the SAME request/transaction
            # (e.g. a later step in a real multi-part endpoint raising) --
            # tenant_scoped_session's `async with session.begin()` rolls the
            # whole transaction back on any exception.
            raise RuntimeError("pretend something after the append blew up")

    after_balance = await _balance(tenant_a, "till")
    assert after_balance == before_balance, "the projection update leaked out despite the rollback"

    async with tenant_scoped_session(tenant_a.business.id) as session:
        after_count_result = await session.execute(
            select(Event).where(
                Event.business_id == tenant_a.business.id, Event.type == "EXPENSE_RECORDED"
            )
        )
        after_count = len(after_count_result.all())
    assert after_count == before_count, "the event leaked out despite the rollback"
