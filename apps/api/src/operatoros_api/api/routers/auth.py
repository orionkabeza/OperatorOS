"""Sign-in (spec D.1 / G.1).

Every failure path here returns the exact same status code and message,
`GENERIC_AUTH_FAILURE`, whether the business exists, the identifier
exists, or the secret is wrong -- no user enumeration. Rate limiting is
per-IP (global) and per (business, identifier, device) lockout, both
Redis-backed. See tests/test_auth.py and tests/test_refresh_rotation.py.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from operatoros_api.api.deps import get_public_session, get_redis
from operatoros_api.audit_log import append_audit_log
from operatoros_api.capabilities import ROLES_REQUIRING_2FA
from operatoros_api.config import get_settings
from operatoros_api.db import tenant_scoped_session
from operatoros_api.models.tenancy import DeviceSession, LoginAttempt, RefreshToken, User, UserLocation
from operatoros_api.schemas.auth import (
    LoginRequest,
    LogoutRequest,
    RefreshRequest,
    TokenPair,
    TotpVerifyRequest,
)
from operatoros_api.security.crypto import decrypt_secret
from operatoros_api.security.identifiers import hash_identifier
from operatoros_api.security.passwords import hash_secret, verify_secret
from operatoros_api.security.rate_limit import LockoutTracker, RateLimiter
from operatoros_api.security.refresh_service import (
    RefreshReuseDetected,
    RefreshTokenInvalid,
    issue_refresh_token,
    rotate_refresh_token,
)
from operatoros_api.security.tokens import (
    AccessTokenClaims,
    TokenError,
    create_access_token,
    create_totp_challenge_token,
    decode_totp_challenge_token,
    hash_refresh_token,
)
from operatoros_api.security.totp import verify_totp_code
from operatoros_api.tenancy_resolution import resolve_business_by_slug

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

GENERIC_AUTH_FAILURE = "That does not match our records."
_DUMMY_SECRET_HASH = hash_secret("no-such-user-dummy-secret-for-timing-normalisation")


async def _assigned_location_ids(session: AsyncSession, user_id: str) -> list[str]:
    result = await session.execute(
        select(UserLocation.location_id).where(UserLocation.user_id == user_id)
    )
    return [row[0] for row in result.all()]


async def _issue_session_tokens(
    session: AsyncSession, *, business_id: str, user: User, device_id: str, remember_device: bool
) -> TokenPair:
    settings = get_settings()
    trusted_until = None
    if remember_device:
        from datetime import timedelta

        trusted_until = datetime.now(UTC) + timedelta(days=settings.device_trust_ttl_days)

    device_session = DeviceSession(
        business_id=business_id,
        user_id=user.id,
        device_id=device_id,
        trusted_until=trusted_until,
        last_seen_at=datetime.now(UTC),
    )
    session.add(device_session)
    await session.flush()

    location_ids = await _assigned_location_ids(session, user.id)
    access = create_access_token(
        AccessTokenClaims(
            user_id=user.id,
            business_id=business_id,
            role_key=user.role.key,
            location_ids=location_ids,
            device_id=device_id,
            session_id=device_session.id,
        )
    )
    raw_refresh, _ = await issue_refresh_token(
        session, business_id=business_id, user_id=user.id, device_session_id=device_session.id
    )
    return TokenPair(access_token=access, refresh_token=raw_refresh)


@router.post("/login", response_model=TokenPair)
async def login(
    body: LoginRequest,
    request: Request,
    public_session: AsyncSession = Depends(get_public_session),
    redis: Any = Depends(get_redis),
) -> TokenPair:
    settings = get_settings()
    ip = request.client.host if request.client else "unknown"

    limiter = RateLimiter(redis)
    if not await limiter.check_and_increment(
        f"login:ip:{ip}", settings.login_rate_limit_per_minute, 60
    ):
        raise HTTPException(status_code=429, detail="Too many attempts. Try again shortly.")

    business = await resolve_business_by_slug(public_session, body.business_slug)
    if business is None or business.status != "active":
        verify_secret(body.secret, _DUMMY_SECRET_HASH)  # normalise timing
        raise HTTPException(status_code=401, detail=GENERIC_AUTH_FAILURE)

    identifier_hash = hash_identifier(body.identifier)
    lockout = LockoutTracker(redis, settings.max_login_attempts, settings.lockout_minutes * 60)
    locked, retry_after = await lockout.is_locked(business.id, identifier_hash, body.device_id)
    if locked:
        raise HTTPException(
            status_code=423,
            detail="Too many tries. This device is locked for a while. "
            "If this wasn't you, contact your manager.",
            headers={"Retry-After": str(retry_after)},
        )

    outcome: dict[str, Any] = {}
    async with tenant_scoped_session(business.id) as session:
        result = await session.execute(
            select(User).where(
                User.business_id == business.id,
                (User.phone_hash == identifier_hash) | (User.email_hash == identifier_hash),
            )
        )
        user = result.scalar_one_or_none()

        secret_ok = verify_secret(body.secret, user.secret_hash) if user else verify_secret(
            body.secret, _DUMMY_SECRET_HASH
        )

        session.add(
            LoginAttempt(
                business_id=business.id,
                identifier_hash=identifier_hash,
                user_id=user.id if user else None,
                succeeded=bool(user and secret_ok and user.status == "active"),
                reason=None if (user and secret_ok) else "bad_credentials",
                ip=ip,
                user_agent=request.headers.get("user-agent"),
                device_id=body.device_id,
            )
        )

        if user is None or not secret_ok or user.status != "active":
            outcome["ok"] = False
            await append_audit_log(
                session, business_id=business.id, event_type="LOGIN_FAILED",
                detail={"identifier_hash": identifier_hash, "reason": "bad_credentials"}, ip=ip,
            )
        elif user.role.key in ROLES_REQUIRING_2FA and user.totp_enabled:
            # Credentials check out, but 2FA hasn't been completed yet --
            # this is neither a completed success nor a failure, so no
            # audit_log entry fires here. totp_verify() below fires
            # LOGIN_SUCCEEDED/LOGIN_FAILED once the second factor is
            # actually checked.
            outcome["ok"] = True
            outcome["totp_required"] = True
            outcome["user_id"] = user.id
        else:
            outcome["ok"] = True
            tokens = await _issue_session_tokens(
                session,
                business_id=business.id,
                user=user,
                device_id=body.device_id,
                remember_device=body.remember_device,
            )
            outcome["tokens"] = tokens
            await append_audit_log(
                session, business_id=business.id, event_type="LOGIN_SUCCEEDED",
                actor_user_id=user.id, detail={"device_id": body.device_id}, ip=ip,
            )

    # `async with tenant_scoped_session` has committed by now -- the
    # LoginAttempt row (success or failure) and any issued tokens are
    # durable. Only now do we decide what to tell the caller.
    if not outcome["ok"]:
        count = await lockout.record_failure(business.id, identifier_hash, body.device_id)
        headers = {}
        if count >= 3:
            headers["X-Remaining-Attempts"] = str(max(settings.max_login_attempts - count, 0))
        raise HTTPException(status_code=401, detail=GENERIC_AUTH_FAILURE, headers=headers or None)

    await lockout.reset(business.id, identifier_hash, body.device_id)

    if outcome.get("totp_required"):
        challenge = create_totp_challenge_token(outcome["user_id"], business.id, body.device_id)
        return TokenPair(access_token="", refresh_token="", totp_required=True, challenge_token=challenge)

    return outcome["tokens"]


@router.post("/totp/verify", response_model=TokenPair)
async def totp_verify(body: TotpVerifyRequest) -> TokenPair:
    try:
        challenge = decode_totp_challenge_token(body.challenge_token)
    except TokenError:
        raise HTTPException(status_code=401, detail=GENERIC_AUTH_FAILURE) from None

    result_tokens: TokenPair | None = None
    async with tenant_scoped_session(challenge.business_id) as session:
        user = await session.get(User, challenge.user_id)
        code_ok = (
            user is not None
            and user.totp_enabled
            and bool(user.totp_secret_encrypted)
            and verify_totp_code(decrypt_secret(user.totp_secret_encrypted), body.code)
        )
        if code_ok:
            result_tokens = await _issue_session_tokens(
                session,
                business_id=challenge.business_id,
                user=user,
                device_id=challenge.device_id,
                remember_device=False,
            )
            await append_audit_log(
                session, business_id=challenge.business_id, event_type="LOGIN_SUCCEEDED",
                actor_user_id=user.id, detail={"device_id": challenge.device_id, "via": "totp"},
            )
        else:
            await append_audit_log(
                session, business_id=challenge.business_id, event_type="LOGIN_FAILED",
                actor_user_id=challenge.user_id,
                detail={"device_id": challenge.device_id, "reason": "bad_totp_code"},
            )

    if result_tokens is None:
        raise HTTPException(status_code=401, detail="That code is wrong or has expired.")
    return result_tokens


@router.post("/refresh", response_model=TokenPair)
async def refresh(body: RefreshRequest) -> TokenPair:
    error: Exception | None = None
    new_tokens: TokenPair | None = None

    async with tenant_scoped_session(body.business_id) as session:
        try:
            new_raw, new_row = await rotate_refresh_token(
                session, business_id=body.business_id, raw_token=body.refresh_token
            )
        except (RefreshReuseDetected, RefreshTokenInvalid) as exc:
            error = exc
        else:
            user = await session.get(User, new_row.user_id)
            device_session = await session.get(DeviceSession, new_row.device_session_id)
            location_ids = await _assigned_location_ids(session, new_row.user_id)
            access = create_access_token(
                AccessTokenClaims(
                    user_id=new_row.user_id,
                    business_id=body.business_id,
                    role_key=user.role.key if user else "",
                    location_ids=location_ids,
                    device_id=device_session.device_id if device_session else "",
                    session_id=new_row.device_session_id,
                )
            )
            new_tokens = TokenPair(access_token=access, refresh_token=new_raw)

    if error is not None:
        raise HTTPException(status_code=401, detail="Session invalidated. Please sign in again.")
    assert new_tokens is not None
    return new_tokens


@router.post("/logout", status_code=204)
async def logout(body: LogoutRequest) -> Response:
    async with tenant_scoped_session(body.business_id) as session:
        token_hash = hash_refresh_token(body.refresh_token)
        result = await session.execute(
            select(RefreshToken).where(
                RefreshToken.business_id == body.business_id,
                RefreshToken.token_hash == token_hash,
            )
        )
        row = result.scalar_one_or_none()
        if row is not None:
            from operatoros_api.security.refresh_service import revoke_family

            await revoke_family(session, family_id=row.family_id, reason="logout")
            device_session = await session.get(DeviceSession, row.device_session_id)
            if device_session is not None:
                device_session.revoked_at = datetime.now(UTC)
    return Response(status_code=204)
