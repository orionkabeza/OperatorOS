"""Plan §2's explicit requirement: `PAYMENT_RECEIVED` must move money in
`money_location_balance` and debt down in `customer_balance` for the SAME
event ATOMICALLY -- one succeeding without the other is exactly the class
of bug Phase 1's stock-check race was, per the task brief. Mirrors
tests/test_projection_transactional.py's proof for SALE_RECORDED/EXPENSE_RECORDED,
applied to the two `PAYMENT_RECEIVED` handlers this phase adds
(projections/customer_balance.py::on_payment_received_balance,
projections/money_location_balance.py::on_payment_received_money).
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from operatoros_api.db import tenant_scoped_session
from operatoros_api.ledger import EventEnvelopeInput, append_event
from operatoros_api.models.customers import CustomerBalance
from operatoros_api.models.events import Event
from operatoros_api.models.projections import MoneyLocationBalance
from tests.conftest import SeededTenant


async def _customer_balance(tenant: SeededTenant) -> int:
    async with tenant_scoped_session(tenant.business.id) as session:
        result = await session.execute(
            select(CustomerBalance).where(CustomerBalance.customer_id == tenant.customer.id)
        )
        row = result.scalar_one_or_none()
        return row.balance_minor if row else 0


async def _till_balance(tenant: SeededTenant) -> int:
    async with tenant_scoped_session(tenant.business.id) as session:
        result = await session.execute(
            select(MoneyLocationBalance).where(
                MoneyLocationBalance.location_id == tenant.location.id,
                MoneyLocationBalance.account_key == "till",
            )
        )
        row = result.scalar_one_or_none()
        return row.balance_minor if row else 0


async def _give_customer_debt(tenant: SeededTenant, amount_minor: int) -> None:
    async with tenant_scoped_session(tenant.business.id) as session:
        await append_event(
            session,
            EventEnvelopeInput(
                business_id=tenant.business.id,
                type="SALE_RECORDED",
                payload={
                    "sale_id": tenant.sale_id,
                    "customer_id": tenant.customer.id,
                    "lines": [],
                    "payments": [
                        {"method": "credit", "amount_minor": amount_minor, "reference": None}
                    ],
                    "subtotal_minor": amount_minor,
                    "discount_minor": 0,
                    "tax_minor": 0,
                    "total_minor": amount_minor,
                },
                actor_user_id=tenant.owner.id,
                actor_source="api",
                location_id=tenant.location.id,
            ),
        )


@pytest.mark.asyncio
async def test_payment_received_moves_debt_and_money_in_the_same_transaction(
    tenant_a: SeededTenant,
) -> None:
    await _give_customer_debt(tenant_a, 500_00)
    debt_before = await _customer_balance(tenant_a)
    till_before = await _till_balance(tenant_a)
    assert debt_before == 500_00

    async with tenant_scoped_session(tenant_a.business.id) as session:
        await append_event(
            session,
            EventEnvelopeInput(
                business_id=tenant_a.business.id,
                type="PAYMENT_RECEIVED",
                payload={
                    "customer_id": tenant_a.customer.id,
                    "amount_minor": 200_00,
                    "method": "cash",
                    "money_location": "till",
                    "reference": None,
                },
                actor_user_id=tenant_a.owner.id,
                actor_source="api",
                location_id=tenant_a.location.id,
            ),
        )
        # Read both projections back INSIDE the same still-open transaction
        # -- proves "same transaction" isn't just true eventually.
        cb_result = await session.execute(
            select(CustomerBalance).where(CustomerBalance.customer_id == tenant_a.customer.id)
        )
        assert cb_result.scalar_one().balance_minor == debt_before - 200_00

        mlb_result = await session.execute(
            select(MoneyLocationBalance).where(
                MoneyLocationBalance.location_id == tenant_a.location.id,
                MoneyLocationBalance.account_key == "till",
            )
        )
        assert mlb_result.scalar_one().balance_minor == till_before + 200_00

    assert await _customer_balance(tenant_a) == debt_before - 200_00
    assert await _till_balance(tenant_a) == till_before + 200_00


@pytest.mark.asyncio
async def test_a_failure_after_payment_received_rolls_back_both_projections_together(
    tenant_a: SeededTenant,
) -> None:
    await _give_customer_debt(tenant_a, 500_00)
    debt_before = await _customer_balance(tenant_a)
    till_before = await _till_balance(tenant_a)

    async with tenant_scoped_session(tenant_a.business.id) as session:
        before_count_result = await session.execute(
            select(Event).where(
                Event.business_id == tenant_a.business.id, Event.type == "PAYMENT_RECEIVED"
            )
        )
        before_count = len(before_count_result.all())

    with pytest.raises(RuntimeError):
        async with tenant_scoped_session(tenant_a.business.id) as session:
            await append_event(
                session,
                EventEnvelopeInput(
                    business_id=tenant_a.business.id,
                    type="PAYMENT_RECEIVED",
                    payload={
                        "customer_id": tenant_a.customer.id,
                        "amount_minor": 100_00,
                        "method": "momo",
                        "money_location": "momo",
                        "reference": None,
                    },
                    actor_user_id=tenant_a.owner.id,
                    actor_source="api",
                    location_id=tenant_a.location.id,
                ),
            )
            raise RuntimeError("pretend a later step in the same request blew up")

    assert (
        await _customer_balance(tenant_a) == debt_before
    ), "the customer_balance projection update leaked out despite the rollback"
    assert (
        await _till_balance(tenant_a) == till_before
    ), "an unrelated account balance changed even though nothing should have committed"

    async with tenant_scoped_session(tenant_a.business.id) as session:
        after_count_result = await session.execute(
            select(Event).where(
                Event.business_id == tenant_a.business.id, Event.type == "PAYMENT_RECEIVED"
            )
        )
        after_count = len(after_count_result.all())
    assert after_count == before_count, "the event leaked out despite the rollback"


@pytest.mark.asyncio
async def test_debt_written_off_zeroes_balance_and_moves_no_money(tenant_a: SeededTenant) -> None:
    await _give_customer_debt(tenant_a, 300_00)
    till_before = await _till_balance(tenant_a)

    async with tenant_scoped_session(tenant_a.business.id) as session:
        await append_event(
            session,
            EventEnvelopeInput(
                business_id=tenant_a.business.id,
                type="DEBT_WRITTEN_OFF",
                payload={
                    "customer_id": tenant_a.customer.id,
                    "amount_minor": 300_00,
                    "reason": "customer disappeared",
                },
                actor_user_id=tenant_a.owner.id,
                actor_source="api",
            ),
        )

    async with tenant_scoped_session(tenant_a.business.id) as session:
        result = await session.execute(
            select(CustomerBalance).where(CustomerBalance.customer_id == tenant_a.customer.id)
        )
        row = result.scalar_one()
        assert row.balance_minor == 0
        assert row.written_off is True
        assert row.written_off_at is not None

    # A write-off is a pure loss -- no money location should have moved.
    assert await _till_balance(tenant_a) == till_before
