"""The projection framework (spec E.3).

Projections update in the SAME database transaction as the event append
that drives them — never eventual consistency. `apply_projections` is
called by `ledger.append_event` after the event row is flushed but before
the caller's transaction commits, so a failure anywhere in a handler rolls
back the event too (see tests/test_projection_transactional.py).

Every write a handler makes is bracketed by `app.projection_writer = true`
for the duration of `apply_projections` — this is the flag the
`reject_direct_projection_write()` Postgres trigger checks (see
alembic/versions/0003_events_and_projections.py). Any write to a
projection table from outside this window, even by the application's own
DB role, is rejected by the trigger. See
tests/test_projection_trigger.py for the proof.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from operatoros_api.models.events import Event

ProjectionHandler = Callable[[AsyncSession, Event], Awaitable[None]]

_HANDLERS: dict[str, list[ProjectionHandler]] = {}


def register_projection(event_type: str) -> Callable[[ProjectionHandler], ProjectionHandler]:
    def _decorator(fn: ProjectionHandler) -> ProjectionHandler:
        _HANDLERS.setdefault(event_type, []).append(fn)
        return fn

    return _decorator


def registered_handlers(event_type: str) -> list[ProjectionHandler]:
    return list(_HANDLERS.get(event_type, []))


async def apply_projections(session: AsyncSession, event: Event) -> None:
    handlers = _HANDLERS.get(event.type, [])
    if not handlers:
        return
    await session.execute(text("SET LOCAL app.projection_writer = 'true'"))
    try:
        for handler in handlers:
            await handler(session, event)
        await session.flush()
    finally:
        await session.execute(text("SET LOCAL app.projection_writer = 'false'"))
