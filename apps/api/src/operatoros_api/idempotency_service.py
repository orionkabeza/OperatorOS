"""Idempotency-Key handling for mutating endpoints (spec G.1).

Store: Postgres, not Redis (see docs/DECISIONS.md for why) — a row in
`idempotency_keys` is claimed with `INSERT ... ON CONFLICT (business_id,
key) DO NOTHING`, in the SAME transaction as the business writes the
endpoint performs. This piggybacks on a real Postgres guarantee that makes
the concurrent-duplicate-request case correct without any extra locking
code: if two requests race to INSERT the same (business_id, key), the
second INSERT blocks until the first transaction commits or rolls back.
If the first commits, the second sees the conflict and (because the first
transaction's UPDATE that stamped the response also committed) can read
back a *fully completed* row immediately — no polling loop needed. If the
first rolls back (e.g. the handler raised), the row never existed and the
second proceeds as if it were first. See tests/test_idempotency.py, which
fires two concurrent requests with the same key and asserts exactly one
event was written.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from operatoros_api.config import get_settings
from operatoros_api.models.idempotency import IdempotencyKey


class IdempotencyKeyConflict(Exception):
    """The same Idempotency-Key was reused for a materially different request."""


def fingerprint_request(method: str, path: str, business_id: str, body: bytes) -> str:
    h = hashlib.sha256()
    h.update(method.encode())
    h.update(b"|")
    h.update(path.encode())
    h.update(b"|")
    h.update(business_id.encode())
    h.update(b"|")
    h.update(body)
    return h.hexdigest()


@dataclass
class IdempotentResult:
    status_code: int
    body: dict[str, Any]
    replayed: bool


async def claim_or_replay(
    session: AsyncSession,
    *,
    business_id: str,
    key: str,
    endpoint: str,
    fingerprint: str,
) -> str | None:
    """Attempt to claim `key` for a fresh execution.

    Returns the claimed row id if this call won the race (caller must go on
    to execute the handler and then call `complete`), or None if a row
    already existed (caller must fetch it via `get_existing` and either
    replay it or raise on fingerprint mismatch).
    """
    settings = get_settings()
    stmt = (
        pg_insert(IdempotencyKey)
        .values(
            business_id=business_id,
            key=key,
            endpoint=endpoint,
            request_fingerprint=fingerprint,
            expires_at=datetime.now(UTC) + timedelta(hours=settings.idempotency_ttl_hours),
        )
        .on_conflict_do_nothing(index_elements=["business_id", "key"])
        .returning(IdempotencyKey.id)
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def get_existing(session: AsyncSession, *, business_id: str, key: str) -> IdempotencyKey:
    result = await session.execute(
        select(IdempotencyKey).where(
            IdempotencyKey.business_id == business_id, IdempotencyKey.key == key
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        # Should not happen: we only call this after claim_or_replay returned
        # None (i.e. a conflicting row exists). A concurrent expiry sweep
        # deleting the row in the tiny window between the two calls is the
        # only way this could fire; treat it as "no prior record."
        raise LookupError("Idempotency key not found.")
    return row


async def complete(
    session: AsyncSession, *, claimed_id: str, status_code: int, body: dict[str, Any]
) -> None:
    row = await session.get(IdempotencyKey, claimed_id)
    if row is None:
        # claimed_id came from claim_or_replay's own successful INSERT
        # moments earlier in the same transaction -- unreachable in
        # practice. An explicit raise, not `assert` (bandit B101: stripped
        # under `python -O`).
        raise RuntimeError("claimed idempotency row disappeared before completion")
    row.status_code = status_code
    row.response_body = body
    row.completed_at = datetime.now(UTC)
    await session.flush()
