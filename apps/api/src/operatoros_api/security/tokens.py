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


def generate_refresh_token() -> tuple[str, str]:
    """Returns (raw_token_to_send_to_client, sha256_hash_to_store)."""
    raw = secrets.token_urlsafe(48)
    return raw, hash_refresh_token(raw)


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()
