"""Phase 1 projections (plan §2): `product_stock`, `customer_balance`,
`daily_totals`/`staff_daily_totals`/`product_daily_movement`, and the
`money_location_balance` extension (SALE_RECORDED payments, DAY_OPENED/
DAY_CLOSED counted-amount resets).

Same two-test-per-projection pattern as Phase 0's
test_projection_transactional.py: (1) the projection reflects the event
inside the SAME still-open transaction (no second round trip), and (2) a
failure after the append rolls back the event and every projection update
it drove, together, leaving no half-applied state.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select

from operatoros_api.db import tenant_scoped_session
from operatoros_api.ledger import EventEnvelopeInput, append_event
from operatoros_api.models.base import uuid7_str
from operatoros_api.models.catalog import Category, Product, ProductLocation, Unit
from operatoros_api.models.customers import Customer, CustomerBalance
from operatoros_api.models.day_till import DaySession
from operatoros_api.models.projections import DailyTotals, ProductDailyMovement, StaffDailyTotals
from operatoros_api.models.stock import StockMovement
from tests.conftest import SeededTenant


async def _make_product(tenant: SeededTenant) -> str:
    async with tenant_scoped_session(tenant.business.id) as session:
        category = Category(business_id=tenant.business.id, name=f"cat-{uuid.uuid4().hex[:6]}")
        # A distinct name each call -- tenant fixtures now seed their own
        # "piece" unit too (tests/conftest.py::make_tenant), and (business_id,
        # name) is unique on `units`.
        unit = Unit(
            business_id=tenant.business.id, name=f"unit-{uuid.uuid4().hex[:6]}", symbol="pc"
        )
        session.add_all([category, unit])
        await session.flush()
        product = Product(
            business_id=tenant.business.id,
            category_id=category.id,
            base_unit_id=unit.id,
            name=f"Product {uuid.uuid4().hex[:6]}",
            sku=f"SKU-{uuid.uuid4().hex[:8]}",
            cost_price_minor=100000,
            selling_price_minor=150000,
        )
        session.add(product)
        await session.flush()
        return product.id


async def _make_customer(tenant: SeededTenant, credit_limit_minor: int = 500000) -> str:
    async with tenant_scoped_session(tenant.business.id) as session:
        # `customer_balances.customer_id` FKs to `customers.id` -- a real
        # Customer row must exist before CUSTOMER_CREATED is appended, same
        # as the real `customers` router will do (models/customers.py
        # module docstring: Customer is a direct-write entity table, the
        # event is the ledger fact alongside it, not a substitute for it).
        customer = Customer(business_id=tenant.business.id, name="Kigali Builders Ltd")
        session.add(customer)
        await session.flush()
        customer_id = customer.id
        await append_event(
            session,
            EventEnvelopeInput(
                business_id=tenant.business.id,
                type="CUSTOMER_CREATED",
                payload={"customer_id": customer_id, "name": "Kigali Builders Ltd"},
                actor_user_id=tenant.owner.id,
                actor_source="api",
            ),
        )
        await append_event(
            session,
            EventEnvelopeInput(
                business_id=tenant.business.id,
                type="CREDIT_LIMIT_CHANGED",
                payload={
                    "customer_id": customer_id,
                    "old_limit_minor": 0,
                    "new_limit_minor": credit_limit_minor,
                },
                actor_user_id=tenant.owner.id,
                actor_source="api",
            ),
        )
        return customer_id


async def _open_day(tenant: SeededTenant) -> str:
    async with tenant_scoped_session(tenant.business.id) as session:
        day = DaySession(
            business_id=tenant.business.id,
            location_id=tenant.location.id,
            business_date=date.today(),
            status="open",
            opened_at=datetime.now(UTC),
            opened_by_user_id=tenant.owner.id,
            opening_counted_amount_minor=0,
            opening_expected_amount_minor=0,
        )
        session.add(day)
        await session.flush()
        return day.id


# --- product_stock ---------------------------------------------------------


@pytest.mark.asyncio
async def test_product_stock_reflects_stock_received_in_the_same_transaction(
    tenant_a: SeededTenant,
) -> None:
    product_id = await _make_product(tenant_a)

    async with tenant_scoped_session(tenant_a.business.id) as session:
        await append_event(
            session,
            EventEnvelopeInput(
                business_id=tenant_a.business.id,
                type="STOCK_RECEIVED",
                payload={
                    "product_id": product_id,
                    "location_id": tenant_a.location.id,
                    "quantity": "40.0000",
                    "unit_cost_minor": 100000,
                },
                actor_user_id=tenant_a.owner.id,
                actor_source="api",
                location_id=tenant_a.location.id,
            ),
        )
        result = await session.execute(
            select(ProductLocation).where(ProductLocation.product_id == product_id)
        )
        row = result.scalar_one()
        assert row.on_hand == Decimal("40.0000")
        assert row.avg_cost_minor == 100000

        movement_result = await session.execute(
            select(StockMovement).where(StockMovement.product_id == product_id)
        )
        movement = movement_result.scalar_one()
        assert movement.quantity_delta == Decimal("40.0000")
        assert movement.running_balance == Decimal("40.0000")
        assert movement.movement_type == "purchase_receipt"

    async with tenant_scoped_session(tenant_a.business.id) as session:
        result = await session.execute(
            select(ProductLocation).where(ProductLocation.product_id == product_id)
        )
        assert result.scalar_one().on_hand == Decimal("40.0000")


@pytest.mark.asyncio
async def test_product_stock_weighted_average_cost_on_second_receipt(
    tenant_a: SeededTenant,
) -> None:
    product_id = await _make_product(tenant_a)

    async with tenant_scoped_session(tenant_a.business.id) as session:
        await append_event(
            session,
            EventEnvelopeInput(
                business_id=tenant_a.business.id,
                type="STOCK_RECEIVED",
                payload={
                    "product_id": product_id,
                    "location_id": tenant_a.location.id,
                    "quantity": "10.0000",
                    "unit_cost_minor": 100000,
                },
                actor_user_id=tenant_a.owner.id,
                actor_source="api",
                location_id=tenant_a.location.id,
            ),
        )
    async with tenant_scoped_session(tenant_a.business.id) as session:
        await append_event(
            session,
            EventEnvelopeInput(
                business_id=tenant_a.business.id,
                type="STOCK_RECEIVED",
                payload={
                    "product_id": product_id,
                    "location_id": tenant_a.location.id,
                    "quantity": "10.0000",
                    "unit_cost_minor": 120000,
                },
                actor_user_id=tenant_a.owner.id,
                actor_source="api",
                location_id=tenant_a.location.id,
            ),
        )
        result = await session.execute(
            select(ProductLocation).where(ProductLocation.product_id == product_id)
        )
        row = result.scalar_one()
        assert row.on_hand == Decimal("20.0000")
        # (10*100000 + 10*120000) / 20 = 110000
        assert row.avg_cost_minor == 110000


@pytest.mark.asyncio
async def test_product_stock_rollback_leaves_on_hand_and_movement_untouched(
    tenant_a: SeededTenant,
) -> None:
    product_id = await _make_product(tenant_a)

    with pytest.raises(RuntimeError):
        async with tenant_scoped_session(tenant_a.business.id) as session:
            await append_event(
                session,
                EventEnvelopeInput(
                    business_id=tenant_a.business.id,
                    type="STOCK_RECEIVED",
                    payload={
                        "product_id": product_id,
                        "location_id": tenant_a.location.id,
                        "quantity": "99.0000",
                        "unit_cost_minor": 50000,
                    },
                    actor_user_id=tenant_a.owner.id,
                    actor_source="api",
                    location_id=tenant_a.location.id,
                ),
            )
            raise RuntimeError("pretend a later step in the same request blew up")

    async with tenant_scoped_session(tenant_a.business.id) as session:
        result = await session.execute(
            select(ProductLocation).where(ProductLocation.product_id == product_id)
        )
        assert result.scalar_one_or_none() is None

        movement_result = await session.execute(
            select(StockMovement).where(StockMovement.product_id == product_id)
        )
        assert movement_result.first() is None


# --- customer_balance --------------------------------------------------------


@pytest.mark.asyncio
async def test_customer_balance_reflects_credit_sale_in_the_same_transaction(
    tenant_a: SeededTenant,
) -> None:
    await _open_day(tenant_a)
    customer_id = await _make_customer(tenant_a, credit_limit_minor=1000000)

    async with tenant_scoped_session(tenant_a.business.id) as session:
        await append_event(
            session,
            EventEnvelopeInput(
                business_id=tenant_a.business.id,
                type="SALE_RECORDED",
                payload={
                    "sale_id": uuid7_str(),
                    "customer_id": customer_id,
                    "lines": [],
                    "payments": [{"method": "credit", "amount_minor": 250000}],
                    "subtotal_minor": 250000,
                    "discount_minor": 0,
                    "tax_minor": 0,
                    "total_minor": 250000,
                },
                actor_user_id=tenant_a.owner.id,
                actor_source="api",
                location_id=tenant_a.location.id,
            ),
        )
        result = await session.execute(
            select(CustomerBalance).where(CustomerBalance.customer_id == customer_id)
        )
        row = result.scalar_one()
        assert row.balance_minor == 250000
        assert row.credit_limit_minor == 1000000
        assert row.oldest_unpaid_at is not None

    async with tenant_scoped_session(tenant_a.business.id) as session:
        result = await session.execute(
            select(CustomerBalance).where(CustomerBalance.customer_id == customer_id)
        )
        assert result.scalar_one().balance_minor == 250000


@pytest.mark.asyncio
async def test_customer_balance_rollback_leaves_balance_untouched(tenant_a: SeededTenant) -> None:
    await _open_day(tenant_a)
    customer_id = await _make_customer(tenant_a)

    with pytest.raises(RuntimeError):
        async with tenant_scoped_session(tenant_a.business.id) as session:
            await append_event(
                session,
                EventEnvelopeInput(
                    business_id=tenant_a.business.id,
                    type="SALE_RECORDED",
                    payload={
                        "sale_id": uuid7_str(),
                        "customer_id": customer_id,
                        "lines": [],
                        "payments": [{"method": "credit", "amount_minor": 400000}],
                        "subtotal_minor": 400000,
                        "discount_minor": 0,
                        "tax_minor": 0,
                        "total_minor": 400000,
                    },
                    actor_user_id=tenant_a.owner.id,
                    actor_source="api",
                    location_id=tenant_a.location.id,
                ),
            )
            raise RuntimeError("pretend a later step in the same request blew up")

    async with tenant_scoped_session(tenant_a.business.id) as session:
        result = await session.execute(
            select(CustomerBalance).where(CustomerBalance.customer_id == customer_id)
        )
        assert result.scalar_one().balance_minor == 0


# --- daily_totals / staff_daily_totals / product_daily_movement -------------


@pytest.mark.asyncio
async def test_daily_totals_reflect_a_cash_sale_in_the_same_transaction(
    tenant_a: SeededTenant,
) -> None:
    await _open_day(tenant_a)
    product_id = await _make_product(tenant_a)

    async with tenant_scoped_session(tenant_a.business.id) as session:
        await append_event(
            session,
            EventEnvelopeInput(
                business_id=tenant_a.business.id,
                type="SALE_RECORDED",
                payload={
                    "sale_id": uuid7_str(),
                    "lines": [
                        {
                            "product_id": product_id,
                            "quantity": "2.0000",
                            "unit_price_minor": 150000,
                            "line_total_minor": 300000,
                        }
                    ],
                    "payments": [{"method": "cash", "amount_minor": 300000}],
                    "subtotal_minor": 300000,
                    "discount_minor": 0,
                    "tax_minor": 0,
                    "total_minor": 300000,
                },
                actor_user_id=tenant_a.owner.id,
                actor_source="api",
                location_id=tenant_a.location.id,
            ),
        )
        totals_result = await session.execute(
            select(DailyTotals).where(DailyTotals.business_id == tenant_a.business.id)
        )
        totals = totals_result.scalar_one()
        assert totals.revenue_minor == 300000
        assert totals.transaction_count == 1
        assert totals.by_payment_method["cash"] == 300000

        staff_result = await session.execute(
            select(StaffDailyTotals).where(StaffDailyTotals.staff_user_id == tenant_a.owner.id)
        )
        staff_totals = staff_result.scalar_one()
        assert staff_totals.sales_amount_minor == 300000
        assert staff_totals.transaction_count == 1

        movement_result = await session.execute(
            select(ProductDailyMovement).where(ProductDailyMovement.product_id == product_id)
        )
        movement = movement_result.scalar_one()
        assert movement.quantity_sold == Decimal("2.0000")
        assert movement.revenue_minor == 300000


@pytest.mark.asyncio
async def test_daily_totals_rollback_leaves_no_row_behind(tenant_a: SeededTenant) -> None:
    await _open_day(tenant_a)
    product_id = await _make_product(tenant_a)

    with pytest.raises(RuntimeError):
        async with tenant_scoped_session(tenant_a.business.id) as session:
            await append_event(
                session,
                EventEnvelopeInput(
                    business_id=tenant_a.business.id,
                    type="SALE_RECORDED",
                    payload={
                        "sale_id": uuid7_str(),
                        "lines": [
                            {
                                "product_id": product_id,
                                "quantity": "1.0000",
                                "unit_price_minor": 150000,
                                "line_total_minor": 150000,
                            }
                        ],
                        "payments": [{"method": "cash", "amount_minor": 150000}],
                        "subtotal_minor": 150000,
                        "discount_minor": 0,
                        "tax_minor": 0,
                        "total_minor": 150000,
                    },
                    actor_user_id=tenant_a.owner.id,
                    actor_source="api",
                    location_id=tenant_a.location.id,
                ),
            )
            raise RuntimeError("pretend a later step in the same request blew up")

    async with tenant_scoped_session(tenant_a.business.id) as session:
        result = await session.execute(
            select(DailyTotals).where(DailyTotals.business_id == tenant_a.business.id)
        )
        assert result.first() is None


@pytest.mark.asyncio
async def test_daily_totals_requires_an_open_day_session(tenant_a: SeededTenant) -> None:
    """No OPEN DaySession exists for this location -- the handler must raise
    rather than silently guess a business_date (module docstring).
    `tenant_a` fixture seeds one open DaySession already (tests/conftest.py,
    needed so the cross-tenant isolation suite has a till_session_id to
    attack), so it's closed here first to reach the genuinely-no-open-day
    state this test is about."""
    product_id = await _make_product(tenant_a)
    async with tenant_scoped_session(tenant_a.business.id) as session:
        day = await session.get(DaySession, tenant_a.day_session.id)
        day.status = "closed"

    with pytest.raises(ValueError, match="No open day session"):
        async with tenant_scoped_session(tenant_a.business.id) as session:
            await append_event(
                session,
                EventEnvelopeInput(
                    business_id=tenant_a.business.id,
                    type="SALE_RECORDED",
                    payload={
                        "sale_id": uuid7_str(),
                        "lines": [
                            {
                                "product_id": product_id,
                                "quantity": "1.0000",
                                "unit_price_minor": 150000,
                                "line_total_minor": 150000,
                            }
                        ],
                        "payments": [{"method": "cash", "amount_minor": 150000}],
                        "subtotal_minor": 150000,
                        "discount_minor": 0,
                        "tax_minor": 0,
                        "total_minor": 150000,
                    },
                    actor_user_id=tenant_a.owner.id,
                    actor_source="api",
                    location_id=tenant_a.location.id,
                ),
            )


# --- money_location_balance extension ---------------------------------------


@pytest.mark.asyncio
async def test_sale_payments_move_money_location_balance_but_credit_lines_do_not(
    tenant_a: SeededTenant,
) -> None:
    await _open_day(tenant_a)
    product_id = await _make_product(tenant_a)
    customer_id = await _make_customer(tenant_a, credit_limit_minor=1000000)

    from operatoros_api.models.projections import MoneyLocationBalance

    async with tenant_scoped_session(tenant_a.business.id) as session:
        await append_event(
            session,
            EventEnvelopeInput(
                business_id=tenant_a.business.id,
                type="SALE_RECORDED",
                payload={
                    "sale_id": uuid7_str(),
                    "customer_id": customer_id,
                    "lines": [
                        {
                            "product_id": product_id,
                            "quantity": "1.0000",
                            "unit_price_minor": 150000,
                            "line_total_minor": 150000,
                        }
                    ],
                    "payments": [
                        {"method": "cash", "amount_minor": 100000},
                        {"method": "credit", "amount_minor": 50000},
                    ],
                    "subtotal_minor": 150000,
                    "discount_minor": 0,
                    "tax_minor": 0,
                    "total_minor": 150000,
                },
                actor_user_id=tenant_a.owner.id,
                actor_source="api",
                location_id=tenant_a.location.id,
            ),
        )
        # "cash" payments land in the "till" account_key, matching D.7.1's
        # named "TILL" balance and DAY_OPENED/DAY_CLOSED's reconciliation
        # target -- see money_location_balance.py's _PAYMENT_METHOD_ACCOUNT_KEY.
        cash_result = await session.execute(
            select(MoneyLocationBalance).where(
                MoneyLocationBalance.location_id == tenant_a.location.id,
                MoneyLocationBalance.account_key == "till",
            )
        )
        assert cash_result.scalar_one().balance_minor == 100000

        credit_result = await session.execute(
            select(MoneyLocationBalance).where(
                MoneyLocationBalance.location_id == tenant_a.location.id,
                MoneyLocationBalance.account_key == "credit",
            )
        )
        assert credit_result.first() is None


@pytest.mark.asyncio
async def test_day_opened_sets_till_balance_to_the_counted_amount(tenant_a: SeededTenant) -> None:
    from operatoros_api.models.projections import MoneyLocationBalance

    async with tenant_scoped_session(tenant_a.business.id) as session:
        # Move some money into "till" first via an unrelated event so the
        # SET (not delta) behaviour is actually exercised.
        await append_event(
            session,
            EventEnvelopeInput(
                business_id=tenant_a.business.id,
                type="MONEY_TRANSFERRED",
                payload={
                    "from_money_location": "bank",
                    "to_money_location": "till",
                    "amount_minor": 999999,
                },
                actor_user_id=tenant_a.owner.id,
                actor_source="api",
                location_id=tenant_a.location.id,
            ),
        )
    async with tenant_scoped_session(tenant_a.business.id) as session:
        await append_event(
            session,
            EventEnvelopeInput(
                business_id=tenant_a.business.id,
                type="DAY_OPENED",
                payload={
                    "counted_amount_minor": 340500,
                    "expected_amount_minor": 340500,
                    "variance_minor": 0,
                },
                actor_user_id=tenant_a.owner.id,
                actor_source="api",
                location_id=tenant_a.location.id,
            ),
        )
        result = await session.execute(
            select(MoneyLocationBalance).where(
                MoneyLocationBalance.location_id == tenant_a.location.id,
                MoneyLocationBalance.account_key == "till",
            )
        )
        assert result.scalar_one().balance_minor == 340500
