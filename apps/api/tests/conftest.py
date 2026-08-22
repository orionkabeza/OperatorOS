"""Test harness: a real, embedded Postgres 16 (via `pgserver`, a
pip-installed binary -- no Docker required in this environment) with real
RLS, real triggers, and real migrations run through Alembic exactly as
production would. Redis is `fakeredis` (in-memory, same command surface
the app's rate limiter/lockout code uses) -- production wires real
`redis:7` (infra/docker-compose.yml); nothing about the *code under test*
differs between the two, only which server answers the commands.

Why an embedded server instead of mocking the database: the entire point
of this phase is that RLS, the projection-write trigger, and the
idempotency race are *real Postgres behaviours* — mocking them would prove
nothing.
"""

from __future__ import annotations

import shutil
import tempfile
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import fakeredis.aioredis
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

import operatoros_api.db as db_module
from operatoros_api.main import create_app
from operatoros_api.models.catalog import Category, Product
from operatoros_api.models.customers import Customer
from operatoros_api.models.day_till import DaySession, TillSession
from operatoros_api.models.expenses import Expense, RecurringExpense
from operatoros_api.models.momo import MomoTransaction
from operatoros_api.models.money_locations import MoneyLocation
from operatoros_api.models.reminders import ReminderSchedule
from operatoros_api.models.sales import Quote, QuoteLine, Receipt, Sale
from operatoros_api.models.stock import Stocktake, StocktakeLine, StockTransfer, StockTransferLine
from operatoros_api.models.tenancy import Business, Location, Role, User
from operatoros_api.seed import (
    create_business,
    create_location,
    create_user,
    seed_default_roles_and_permissions,
    seed_default_units,
)

APPS_API_DIR = Path(__file__).resolve().parents[1]
TEST_APP_PASSWORD = "operatoros_app_test_pw"


@pytest.fixture(scope="session")
def postgres_urls() -> dict[str, str]:
    import pgserver

    tmp_dir = tempfile.mkdtemp(prefix="operatoros_pg_")
    server = pgserver.get_server(tmp_dir, cleanup_mode="stop")
    admin_uri = server.get_uri()

    # pgserver listens on TCP on Windows but on a Unix domain socket on
    # Linux and macOS, where `get_uri()` has no hostname or port at all --
    # the socket directory arrives as a `?host=` query parameter instead.
    # Formatting that into "@{None}:{None}/" produced a URL SQLAlchemy
    # rejected with `invalid literal for int() with base 10: 'None'`, which
    # errored the setup of every single test. It never showed up locally
    # (Windows takes the TCP path) and never showed up in CI either,
    # because CI only ran on pull requests and the old integration branch
    # while all work goes straight to main -- so this suite, including the
    # cross-tenant isolation tests the spec makes a build-failing
    # requirement, had never actually run on a runner. Both transports are
    # handled here; libpq, psycopg and asyncpg all accept a socket
    # directory passed as `host`.
    parts = urlsplit(admin_uri)
    host, port = parts.hostname, parts.port
    if host:
        authority, suffix = f"{host}:{port}", ""
    else:
        socket_dir = parse_qs(parts.query).get("host", [None])[0]
        if not socket_dir:
            raise RuntimeError(
                f"cannot find a host or a socket directory in pgserver's URI: {admin_uri}"
            )
        authority, suffix = "", f"?host={socket_dir}"

    bootstrap_url = f"postgresql+psycopg://postgres:@{authority}/postgres{suffix}"
    bootstrap_engine = create_engine(bootstrap_url, isolation_level="AUTOCOMMIT")
    with bootstrap_engine.connect() as conn:
        conn.execute(text("CREATE DATABASE operatoros_test"))
        conn.execute(
            text(
                f"CREATE ROLE operatoros_app LOGIN PASSWORD '{TEST_APP_PASSWORD}' "
                "NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS"
            )
        )
    bootstrap_engine.dispose()

    admin_url = f"postgresql+psycopg://postgres:@{authority}/operatoros_test{suffix}"
    testdb_engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with testdb_engine.connect() as conn:
        conn.execute(text("GRANT CONNECT ON DATABASE operatoros_test TO operatoros_app"))
        conn.execute(text("GRANT USAGE ON SCHEMA public TO operatoros_app"))
    testdb_engine.dispose()

    from alembic import command
    from alembic.config import Config

    alembic_cfg = Config(str(APPS_API_DIR / "alembic.ini"))
    alembic_cfg.set_main_option("script_location", str(APPS_API_DIR / "alembic"))
    alembic_cfg.attributes["sqlalchemy.url"] = admin_url
    command.upgrade(alembic_cfg, "head")

    urls = {
        "admin": admin_url,
        "app_async": (
            f"postgresql+asyncpg://operatoros_app:{TEST_APP_PASSWORD}@{authority}"
            f"/operatoros_test{suffix}"
        ),
        "app_sync": (
            f"postgresql+psycopg://operatoros_app:{TEST_APP_PASSWORD}@{authority}"
            f"/operatoros_test{suffix}"
        ),
    }
    yield urls
    server.cleanup()
    # `server.cleanup()` (cleanup_mode="stop") stops the postgres process
    # but does NOT delete `tmp_dir` -- a real Postgres data directory,
    # observed at 50-100MB+ per test session. Left as-is, every local
    # `pytest` run (and every one of this session's many invocations)
    # leaves one behind under the OS temp dir permanently; found the hard
    # way when 56 accumulated sessions' worth filled the disk to 0 bytes
    # free mid-task. Explicit removal here is the safety net regardless of
    # what cleanup_mode is doing internally.
    shutil.rmtree(tmp_dir, ignore_errors=True)


@pytest.fixture(scope="session", autouse=True)
def _wire_app_engine(postgres_urls: dict[str, str]) -> None:
    db_module.reset_engine_for_tests(postgres_urls["app_async"])


@pytest_asyncio.fixture
async def fake_redis() -> AsyncIterator[fakeredis.aioredis.FakeRedis]:
    client = fakeredis.aioredis.FakeRedis()
    yield client
    await client.flushall()
    await client.aclose()


@pytest_asyncio.fixture
async def app(fake_redis: fakeredis.aioredis.FakeRedis, postgres_urls: dict[str, str]):
    return create_app(redis_client=fake_redis)


@pytest_asyncio.fixture
async def client(app) -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@dataclass
class SeededTenant:
    business: Business
    location: Location
    roles: dict[str, Role]
    owner: User
    owner_phone: str
    owner_secret: str
    # Phase 1 additions: one of each new resource type, seeded directly (not
    # through the API) so tests/test_cross_tenant_isolation.py's
    # RESOURCE_ID_SEEDS has a real tenant-B id to attack for every new path
    # parameter registered there (product_id, customer_id, quote_id,
    # receipt_number, till_session_id).
    product: Product
    customer: Customer
    day_session: DaySession
    till_session: TillSession
    quote: Quote
    receipt_number: int
    sale_id: str
    stocktake: Stocktake
    stocktake_line: StocktakeLine
    transfer: StockTransfer
    # Phase 2 additions -- same reasoning as the Phase 1 block above,
    # applied to the new resource types this phase's routers introduce.
    money_location: MoneyLocation
    momo_transaction: MomoTransaction
    expense: Expense
    recurring_expense: RecurringExpense
    reminder_schedule: ReminderSchedule


async def make_tenant(label: str) -> SeededTenant:
    slug = f"{label}-{uuid.uuid4().hex[:8]}"
    phone = f"+2507{uuid.uuid4().int % 10**8:08d}"
    secret = "482913"

    async with db_module.tenant_scoped_session(None) as session:
        # `businesses` has no RLS (see models/tenancy.py) so this insert
        # is legal with no tenant GUC set -- it's the tenant being born.
        business = await create_business(session, name=label, slug=slug)
        business_id = business.id

    async with db_module.tenant_scoped_session(business_id) as session:
        location = await create_location(session, business_id=business_id, name="Main")
        units = await seed_default_units(session, business_id=business_id)
        roles = await seed_default_roles_and_permissions(session, business_id=business_id)
        owner = await create_user(
            session,
            business_id=business_id,
            role=roles["owner"],
            display_name=f"{label} Owner",
            secret=secret,
            phone=phone,
            location_ids=[location.id],
        )

        category = Category(business_id=business_id, name="General")
        session.add(category)
        await session.flush()
        # Reuse the shared default units rather than hand-rolling one, so a
        # fixture tenant matches what a real new business actually gets --
        # the stated purpose of operatoros_api.seed.
        unit = next(u for u in units if u.name == "piece")
        product = Product(
            business_id=business_id,
            category_id=category.id,
            base_unit_id=unit.id,
            name=f"{label} Product",
            sku=f"SKU-{uuid.uuid4().hex[:8]}",
            cost_price_minor=100000,
            selling_price_minor=150000,
        )
        session.add(product)

        customer = Customer(business_id=business_id, name=f"{label} Customer", phone=phone)
        session.add(customer)

        now = datetime.now(UTC)
        day_session = DaySession(
            business_id=business_id,
            location_id=location.id,
            business_date=date.today(),
            status="open",
            opened_at=now,
            opened_by_user_id=owner.id,
            opening_counted_amount_minor=0,
            opening_expected_amount_minor=0,
        )
        session.add(day_session)
        await session.flush()

        till_session = TillSession(
            business_id=business_id,
            location_id=location.id,
            day_session_id=day_session.id,
            cashier_user_id=owner.id,
            status="open",
            opened_at=now,
            opening_float_minor=0,
        )
        session.add(till_session)

        # receipt_number/quote_number are only unique WITHIN a business (each
        # business has its own sequence, models/sales.py::ReceiptSequence) --
        # RLS, not the number itself, is what's supposed to stop tenant A
        # from reading tenant B's receipt/quote. Using the same number (e.g.
        # both "1") for every seeded tenant would make the isolation attack
        # below pass vacuously (RLS would resolve "1" to the ATTACKER's own
        # row, never reaching tenant B's), so these are randomised instead --
        # a real, distinct id to attack with, not a coincidentally-shared one.
        quote_number = uuid.uuid4().int % 900000 + 100000
        quote = Quote(
            business_id=business_id,
            location_id=location.id,
            customer_id=customer.id,
            quote_number=quote_number,
            created_by_user_id=owner.id,
            subtotal_minor=150000,
            discount_minor=0,
            tax_minor=0,
            total_minor=150000,
            status="open",
            expires_at=now + timedelta(days=14),
            source_event_id="seed",
        )
        session.add(quote)
        await session.flush()
        session.add(
            QuoteLine(
                business_id=business_id,
                quote_id=quote.id,
                product_id=product.id,
                quantity=Decimal("1.0000"),
                unit_price_minor=150000,
                line_total_minor=150000,
            )
        )

        sale = Sale(
            business_id=business_id,
            location_id=location.id,
            day_session_id=day_session.id,
            till_session_id=till_session.id,
            cashier_user_id=owner.id,
            subtotal_minor=150000,
            discount_minor=0,
            tax_minor=0,
            total_minor=150000,
            status="completed",
            source_event_id="seed",
        )
        session.add(sale)
        await session.flush()
        receipt_number = uuid.uuid4().int % 900000 + 100000
        receipt = Receipt(business_id=business_id, sale_id=sale.id, receipt_number=receipt_number)
        session.add(receipt)

        second_location = await create_location(
            session, business_id=business_id, name="Secondary", is_primary=False
        )

        stocktake = Stocktake(
            business_id=business_id,
            location_id=location.id,
            scope="all",
            status="counting",
            started_by_user_id=owner.id,
            started_at=now,
        )
        session.add(stocktake)
        await session.flush()
        stocktake_line = StocktakeLine(
            business_id=business_id,
            stocktake_id=stocktake.id,
            product_id=product.id,
            expected_quantity=Decimal("0"),
        )
        session.add(stocktake_line)

        transfer = StockTransfer(
            business_id=business_id,
            from_location_id=location.id,
            to_location_id=second_location.id,
            status="in_transit",
            created_by_user_id=owner.id,
            sent_at=now,
        )
        session.add(transfer)
        await session.flush()
        session.add(
            StockTransferLine(
                business_id=business_id,
                transfer_id=transfer.id,
                product_id=product.id,
                quantity_sent=Decimal("0"),
            )
        )

        money_location = MoneyLocation(
            business_id=business_id,
            location_id=location.id,
            account_key="till",
            display_name="TILL",
            kind="till",
            connection_status="manual",
        )
        session.add(money_location)

        momo_transaction = MomoTransaction(
            business_id=business_id,
            provider="sandbox_momo",
            external_id=f"seed-{uuid.uuid4().hex[:12]}",
            phone=phone,
            amount_minor=10000,
            direction="in",
            occurred_at=now,
            raw_payload={},
            status="unmatched",
        )
        session.add(momo_transaction)

        expense = Expense(
            business_id=business_id,
            location_id=location.id,
            amount_minor=5000,
            category="Other",
            money_location="till",
            expense_date=date.today(),
            status="pending_approval",
            created_by_user_id=owner.id,
        )
        session.add(expense)

        recurring_expense = RecurringExpense(
            business_id=business_id,
            location_id=location.id,
            amount_minor=300000,
            category="Rent",
            money_location="bank",
            interval="monthly",
            next_run_date=date.today(),
            active=True,
            created_by_user_id=owner.id,
        )
        session.add(recurring_expense)

        # A per-CUSTOMER override, not the business default -- a business
        # only ever has one default (customer_id IS NULL), enforced by a
        # genuine partial unique index (migration 0015, see
        # docs/DECISIONS.md); seeding one here as a "default" would
        # collide with any test that creates its own default via the API
        # (tests/test_reminders.py does exactly that). An override is a
        # real, independent resource that still needs isolation coverage.
        reminder_schedule = ReminderSchedule(
            business_id=business_id, customer_id=customer.id, name="Customer override"
        )
        session.add(reminder_schedule)
        await session.flush()

    return SeededTenant(
        business=business,
        location=location,
        roles=roles,
        owner=owner,
        owner_phone=phone,
        owner_secret=secret,
        product=product,
        customer=customer,
        day_session=day_session,
        till_session=till_session,
        quote=quote,
        receipt_number=receipt.receipt_number,
        sale_id=sale.id,
        stocktake=stocktake,
        stocktake_line=stocktake_line,
        transfer=transfer,
        money_location=money_location,
        momo_transaction=momo_transaction,
        expense=expense,
        recurring_expense=recurring_expense,
        reminder_schedule=reminder_schedule,
    )


@pytest_asyncio.fixture
async def tenant_a(postgres_urls: dict[str, str]) -> SeededTenant:
    return await make_tenant("tenant-a")


@pytest_asyncio.fixture
async def tenant_b(postgres_urls: dict[str, str]) -> SeededTenant:
    return await make_tenant("tenant-b")
