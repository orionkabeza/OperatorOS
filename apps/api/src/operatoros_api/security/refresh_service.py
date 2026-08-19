"""Refresh token issuance, rotation, and reuse detection (spec G.1).

Rotation model: each refresh consumes the presented token (`used_at` set)
and issues a new one in the same `family_id`, linked via
`previous_token_id`. If a token that has already been consumed (or
revoked) is presented again, the entire family is revoked — this is what
"refresh reuse detection revokes the family" means: it treats reuse of a
stale token as evidence the token was copied (stolen), so every descendant
and ancestor session sharing that family dies, not just the one call.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from operatoros_api.config import get_settings
from operatoros_api.models.tenancy import RefreshToken
from operatoros_api.security.tokens import generate_refresh_token, hash_refresh_token


class RefreshTokenInvalid(Exception):
    pass


class RefreshReuseDetected(Exception):
    """Raised when a consumed/revoked token is presented again.

    The caller MUST treat this as "log the user out everywhere" — by the
    time this raises, the whole token family has already been revoked in
    the database (best-effort within this call's transaction).
    """


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)


async def issue_refresh_token(
    session: AsyncSession,
    *,
    business_id: str,
    user_id: str,
    device_session_id: str,
    family_id: str | None = None,
    previous_token_id: str | None = None,
) -> tuple[str, RefreshToken]:
    settings = get_settings()
    raw, token_hash = generate_refresh_token()
    row = RefreshToken(
        business_id=business_id,
        user_id=user_id,
        device_session_id=device_session_id,
        family_id=family_id or str(uuid.uuid4()),
        previous_token_id=previous_token_id,
        token_hash=token_hash,
        expires_at=datetime.now(UTC) + timedelta(days=settings.refresh_token_ttl_days),
    )
    session.add(row)
    await session.flush()
    return raw, row


async def rotate_refresh_token(
    session: AsyncSession, *, business_id: str, raw_token: str
) -> tuple[str, RefreshToken]:
    """Verify `raw_token`, rotate it, and return (new_raw_token, new_row).

    Raises `RefreshTokenInvalid` for an unknown/expired/already-revoked
    token, and `RefreshReuseDetected` when the token was already consumed
    by a prior rotation (family is revoked as a side effect before raising).
    """
    token_hash = hash_refresh_token(raw_token)
    result = await session.execute(
        select(RefreshToken).where(
            RefreshToken.token_hash == token_hash,
            RefreshToken.business_id == business_id,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise RefreshTokenInvalid("Unknown refresh token.")

    now = datetime.now(UTC)

    if row.used_at is not None or row.revoked_at is not None:
        await session.execute(
            update(RefreshToken)
            .where(RefreshToken.family_id == row.family_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=now, revoked_reason="reuse_detected")
        )
        await session.flush()
        raise RefreshReuseDetected("Refresh token reuse detected; session family revoked.")

    if _aware(row.expires_at) < now:
        raise RefreshTokenInvalid("Refresh token expired.")

    row.used_at = now
    await session.flush()

    new_raw, new_row = await issue_refresh_token(
        session,
        business_id=row.business_id,
        user_id=row.user_id,
        device_session_id=row.device_session_id,
        family_id=row.family_id,
        previous_token_id=row.id,
    )
    return new_raw, new_row


async def revoke_family(session: AsyncSession, *, family_id: str, reason: str) -> None:
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC), revoked_reason=reason)
    )
