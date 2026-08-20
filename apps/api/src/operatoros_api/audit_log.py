"""Append + chain-verification for the tamper-evident audit log.

Each row's `hash` covers its own canonical content AND the previous row's
`hash` (`prev_hash`), scoped per business (each tenant has its own
independent chain, starting from `GENESIS_HASH`). Re-walking the chain
from the start and recomputing every hash is how tampering with any row
-- not just the most recent one -- is detected: changing row N's content
without also rewriting every hash from N onward breaks the chain at N.

Concurrency: appending requires knowing the previous row's hash, which is
a race between concurrent requests unless serialized. A Postgres advisory
transaction lock scoped by `hashtext(business_id)`
(`pg_advisory_xact_lock`, auto-released at transaction end) closes that
race without needing a separate "chain head" table: two concurrent
appends for the same business simply queue behind each other for the
duration of computing seq/prev_hash and inserting the row.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from operatoros_api.models.audit_log import AuditLogEntry
from operatoros_api.models.base import uuid7_str

GENESIS_HASH = "0" * 64


def _canonical(payload: dict) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)


def compute_hash(
    *,
    business_id: str,
    seq: int,
    event_type: str,
    actor_user_id: str | None,
    subject_user_id: str | None,
    detail: dict,
    ip: str | None,
    occurred_at: datetime,
    prev_hash: str,
) -> str:
    canonical = _canonical(
        {
            "business_id": business_id,
            "seq": seq,
            "event_type": event_type,
            "actor_user_id": actor_user_id,
            "subject_user_id": subject_user_id,
            "detail": detail,
            "ip": ip,
            "occurred_at": occurred_at.isoformat(),
            "prev_hash": prev_hash,
        }
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def append_audit_log(
    session: AsyncSession,
    *,
    business_id: str,
    event_type: str,
    actor_user_id: str | None = None,
    subject_user_id: str | None = None,
    detail: dict | None = None,
    ip: str | None = None,
) -> AuditLogEntry:
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:bid))"), {"bid": business_id}
    )

    result = await session.execute(
        select(AuditLogEntry.seq, AuditLogEntry.hash)
        .where(AuditLogEntry.business_id == business_id)
        .order_by(AuditLogEntry.seq.desc())
        .limit(1)
    )
    row = result.first()
    prev_seq, prev_hash = (row.seq, row.hash) if row else (0, GENESIS_HASH)

    occurred_at = datetime.now(UTC)
    seq = prev_seq + 1
    detail = detail or {}
    entry_hash = compute_hash(
        business_id=business_id,
        seq=seq,
        event_type=event_type,
        actor_user_id=actor_user_id,
        subject_user_id=subject_user_id,
        detail=detail,
        ip=ip,
        occurred_at=occurred_at,
        prev_hash=prev_hash,
    )
    entry = AuditLogEntry(
        id=uuid7_str(),
        business_id=business_id,
        seq=seq,
        event_type=event_type,
        actor_user_id=actor_user_id,
        subject_user_id=subject_user_id,
        detail=detail,
        ip=ip,
        occurred_at=occurred_at,
        prev_hash=prev_hash,
        hash=entry_hash,
    )
    session.add(entry)
    await session.flush()
    return entry


@dataclass(frozen=True)
class ChainVerificationResult:
    ok: bool
    broken_at_seq: int | None = None
    reason: str | None = None


async def verify_chain(session: AsyncSession, *, business_id: str) -> ChainVerificationResult:
    result = await session.execute(
        select(AuditLogEntry)
        .where(AuditLogEntry.business_id == business_id)
        .order_by(AuditLogEntry.seq)
    )
    rows = list(result.scalars())

    expected_prev = GENESIS_HASH
    for row in rows:
        if row.prev_hash != expected_prev:
            return ChainVerificationResult(
                ok=False,
                broken_at_seq=row.seq,
                reason=f"prev_hash mismatch at seq {row.seq}: chain does not connect",
            )
        recomputed = compute_hash(
            business_id=row.business_id,
            seq=row.seq,
            event_type=row.event_type,
            actor_user_id=row.actor_user_id,
            subject_user_id=row.subject_user_id,
            detail=row.detail,
            ip=row.ip,
            occurred_at=row.occurred_at,
            prev_hash=row.prev_hash,
        )
        if recomputed != row.hash:
            return ChainVerificationResult(
                ok=False,
                broken_at_seq=row.seq,
                reason=f"hash mismatch at seq {row.seq}: row content was modified after being written",
            )
        expected_prev = row.hash

    return ChainVerificationResult(ok=True)
