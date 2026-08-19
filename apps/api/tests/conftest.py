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

import tempfile
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

import fakeredis.aioredis
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

import operatoros_api.db as db_module
from operatoros_api.main import create_app
from operatoros_api.models.tenancy import Business, Location, Role, User
from operatoros_api.seed import create_business, create_location, create_user, seed_default_roles_and_permissions

APPS_API_DIR = Path(__file__).resolve().parents[1]
TEST_APP_PASSWORD = "operatoros_app_test_pw"


@pytest.fixture(scope="session")
def postgres_urls() -> dict[str, str]:
    import pgserver

    tmp_dir = tempfile.mkdtemp(prefix="operatoros_pg_")
    server = pgserver.get_server(tmp_dir, cleanup_mode="stop")
    admin_uri = server.get_uri()

    parts = urlsplit(admin_uri)
    host, port = parts.hostname, parts.port

    bootstrap_url = f"postgresql+psycopg://postgres:@{host}:{port}/postgres"
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

    admin_url = f"postgresql+psycopg://postgres:@{host}:{port}/operatoros_test"
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
        "app_async": f"postgresql+asyncpg://operatoros_app:{TEST_APP_PASSWORD}@{host}:{port}/operatoros_test",
        "app_sync": f"postgresql+psycopg://operatoros_app:{TEST_APP_PASSWORD}@{host}:{port}/operatoros_test",
        "host": host,
        "port": str(port),
    }
    yield urls
    server.cleanup()


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

    return SeededTenant(
        business=business, location=location, roles=roles,
        owner=owner, owner_phone=phone, owner_secret=secret,
    )


@pytest_asyncio.fixture
async def tenant_a(postgres_urls: dict[str, str]) -> SeededTenant:
    return await make_tenant("tenant-a")


@pytest_asyncio.fixture
async def tenant_b(postgres_urls: dict[str, str]) -> SeededTenant:
    return await make_tenant("tenant-b")
