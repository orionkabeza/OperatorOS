"""Access token (JWT, 15 min TTL) creation/verification, and refresh token
(opaque, hashed at rest) generation primitives.

Rotation + reuse-detection *business logic* lives in
`security/refresh_service.py` since it needs DB access; this module is the
pure crypto/encoding layer.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt

from operatoros_api.config import get_settings


@dataclass(frozen=True)
class AccessTokenClaims:
    user_id: str
    business_id: str
    role_key: str
    location_ids: list[str]
    device_id: str
    session_id: str


class TokenError(Exception):
    pass


def create_access_token(claims: AccessTokenClaims) -> str:
    settings = get_settings()
    now = datetime.now(UTC)
    payload = {
        "sub": claims.user_id,
        "business_id": claims.business_id,
        "role": claims.role_key,
        "loc": claims.location_ids,
        "device_id": claims.device_id,
        "sid": claims.session_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.access_token_ttl_minutes)).timestamp()),
        "jti": str(uuid.uuid4()),
        "type": "access",
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> AccessTokenClaims:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError as exc:
        raise TokenError("Invalid or expired session.") from exc
    if payload.get("type") != "access":
        raise TokenError("Invalid or expired session.")
    return AccessTokenClaims(
        user_id=payload["sub"],
        business_id=payload["business_id"],
        role_key=payload["role"],
        location_ids=list(payload.get("loc", [])),
        device_id=payload.get("device_id", ""),
        session_id=payload.get("sid", ""),
    )


@dataclass(frozen=True)
class TotpChallengeClaims:
    user_id: str
    business_id: str
    device_id: str


def create_totp_challenge_token(user_id: str, business_id: str, device_id: str) -> str:
    """Short-lived (5 min), single-purpose token proving "this caller
    already presented a correct identifier+PIN/password for this user" --
    issued instead of real tokens when 2FA is required (D.1). It cannot be
    used as an access token: `type` differs and `decode_access_token`
    checks it."""
    settings = get_settings()
    now = datetime.now(UTC)
    payload = {
        "sub": user_id,
        "business_id": business_id,
        "device_id": device_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=5)).timestamp()),
        "jti": str(uuid.uuid4()),
        "type": "totp_challenge",
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_totp_challenge_token(token: str) -> TotpChallengeClaims:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError as exc:
        raise TokenError("Invalid or expired code challenge.") from exc
    if payload.get("type") != "totp_challenge":
        raise TokenError("Invalid or expired code challenge.")
    return TotpChallengeClaims(
        user_id=payload["sub"],
        business_id=payload["business_id"],
        device_id=payload.get("device_id", ""),
    )


@dataclass(frozen=True)
class PayLinkTokenClaims:
    pay_link_id: str
    business_id: str


def create_pay_link_token(*, pay_link_id: str, business_id: str, expires_at: datetime) -> str:
    """A signed, single-use-enforced-at-the-DB-row-not-here, expiring
    token (spec D.6.5/plan §0.5: "A signed, single-use, expiring token
    (/pay/{token})"). This is the SAME "identify the tenant from a
    server-signed claim before any RLS-scoped lookup is possible" shape
    `create_access_token` already solves for logged-in sessions -- here
    the "session" is a public, unauthenticated capability scoped to
    exactly one `PayLink` row rather than a user.

    Deliberately does NOT store the token string anywhere -- there is
    nothing to look up by token text; the token itself, once its signature
    verifies, directly names `business_id`/`pay_link_id`. "Single-use" is
    enforced by `api/routers/pay.py` checking the referenced row's live
    `status` (pending -> paid/expired, never back), not by tracking used
    tokens here -- a still-cryptographically-valid token whose row has
    already moved to `paid` must still be rejected.
    """
    settings = get_settings()
    now = datetime.now(UTC)
    payload = {
        "pay_link_id": pay_link_id,
        "business_id": business_id,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "jti": str(uuid.uuid4()),
        "type": "pay_link",
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_pay_link_token(token: str) -> PayLinkTokenClaims:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError as exc:
        raise TokenError("Invalid or expired payment link.") from exc
    if payload.get("type") != "pay_link":
        raise TokenError("Invalid or expired payment link.")
    return PayLinkTokenClaims(
        pay_link_id=payload["pay_link_id"], business_id=payload["business_id"]
    )


def generate_refresh_token() -> tuple[str, str]:
    """Returns (raw_token_to_send_to_client, sha256_hash_to_store)."""
    raw = secrets.token_urlsafe(48)
    return raw, hash_refresh_token(raw)


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()
