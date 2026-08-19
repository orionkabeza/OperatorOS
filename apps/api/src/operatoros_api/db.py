"""Database engine + the tenant-scoped session (the RLS enforcement seam).

The single most important function in this module is
`tenant_scoped_session`: it opens one connection, starts one transaction,
sets the `app.business_id` (and `app.location_ids`) session GUCs as the
FIRST statement in that transaction via `set_config(..., true)` (the
`true` third argument makes it `SET LOCAL`-equivalent — scoped to the
transaction, reset on commit/rollback, never leaked to a pooled connection
reused by a different request), and only then yields the session for the
route handler to use. Every RLS policy in the schema reads that GUC.

`business_id=None` is legal ONLY for the narrow pre-auth business-slug
resolution path (`api/routers/auth.py`), which reads solely from
`businesses` — the one table without RLS. Every other table has
`ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`, so a query
against them with the GUC unset (or set to a business_id that doesn't
match) returns zero rows rather than leaking — that's what "FORCE" buys
over plain "ENABLE": it applies the policy even to the table owner.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from operatoros_api.config import get_settings

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def get_engine(database_url: str | None = None) -> AsyncEngine:
    global _engine
    if _engine is None:
        _engine = create_async_engine(
            database_url or get_settings().database_url, pool_pre_ping=True
        )
    return _engine


def get_session_factory(database_url: str | None = None) -> async_sessionmaker[AsyncSession]:
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            bind=get_engine(database_url), expire_on_commit=False
        )
    return _session_factory


def reset_engine_for_tests(database_url: str) -> None:
    """Test-only: point the module-level engine/session factory at a fresh
    database URL (the embedded pgserver instance). Never called outside
    tests/conftest.py."""
    global _engine, _session_factory
    _engine = create_async_engine(database_url, pool_pre_ping=True)
    _session_factory = async_sessionmaker(bind=_engine, expire_on_commit=False)


async def _set_tenant_guc(
    session: AsyncSession, business_id: str | None, location_ids: list[str] | None
) -> None:
    await session.execute(
        text("SELECT set_config('app.business_id', :v, true)"), {"v": business_id or ""}
    )
    await session.execute(
        text("SELECT set_config('app.location_ids', :v, true)"),
        {"v": ",".join(location_ids) if location_ids else ""},
    )


@asynccontextmanager
async def tenant_scoped_session(
    business_id: str | None, location_ids: list[str] | None = None
) -> AsyncIterator[AsyncSession]:
    factory = get_session_factory()
    async with factory() as session:
        async with session.begin():
            await _set_tenant_guc(session, business_id, location_ids)
            yield session
