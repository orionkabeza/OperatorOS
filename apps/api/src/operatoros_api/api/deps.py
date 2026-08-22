"""FastAPI dependencies: the seam where auth, RLS, and capabilities meet.

`get_current_context` is the one dependency almost every protected route
depends on. It (a) verifies the access token, (b) opens a tenant-scoped DB
session bound to the token's `business_id` (never a request parameter --
G.1), (c) re-loads the user from the DB (so a suspended/deleted user or a
role change is honoured even mid-token-lifetime, not just at next login),
and (d) resolves effective capabilities. `require_capability` layers a
capability check on top -- independent of, and in addition to, RLS.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from operatoros_api.capabilities import EffectiveCapabilities, resolve_effective_capabilities
from operatoros_api.db import tenant_scoped_session
from operatoros_api.models.tenancy import User, UserLocation
from operatoros_api.security.tokens import TokenError, decode_access_token

_bearer_scheme = HTTPBearer(auto_error=False)

# The web frontend (apps/web) never handles a raw access token in
# client-side JS -- its own server-side session route handlers
# (app/session/*/route.ts) set this as an httpOnly cookie instead, so an
# XSS bug in the frontend can't exfiltrate it. A future non-browser
# client (mobile app, API integration) still authenticates the ordinary
# way, via the Authorization header -- this is an additional accepted
# source, not a replacement. See docs/DECISIONS.md.
ACCESS_TOKEN_COOKIE_NAME = "operatoros_access_token"


@dataclass
class RequestContext:
    session: AsyncSession
    business_id: str
    user_id: str
    role_key: str
    location_ids: list[str]
    device_id: str
    capabilities: EffectiveCapabilities


async def get_public_session() -> AsyncIterator[AsyncSession]:
    """A session with no tenant GUC set. Only safe against `businesses`
    (the one table without RLS) -- see tenancy_resolution.py."""
    async with tenant_scoped_session(None) as session:
        yield session


async def get_redis(request: Request):
    return request.app.state.redis


async def get_current_context(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> AsyncIterator[RequestContext]:
    token = (
        credentials.credentials if credentials else request.cookies.get(ACCESS_TOKEN_COOKIE_NAME)
    )
    if token is None:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    try:
        claims = decode_access_token(token)
    except TokenError:
        raise HTTPException(status_code=401, detail="Not authenticated.") from None

    async with tenant_scoped_session(claims.business_id, claims.location_ids) as session:
        user = await session.get(User, claims.user_id)
        if user is None or user.status != "active":
            raise HTTPException(status_code=401, detail="Not authenticated.")

        loc_result = await session.execute(
            select(UserLocation.location_id).where(UserLocation.user_id == user.id)
        )
        location_ids = [row[0] for row in loc_result.all()]

        caps = await resolve_effective_capabilities(
            session,
            user_id=user.id,
            role_key=user.role.key,
            assigned_location_ids=location_ids,
        )

        yield RequestContext(
            session=session,
            business_id=claims.business_id,
            user_id=user.id,
            role_key=user.role.key,
            location_ids=location_ids,
            device_id=claims.device_id,
            capabilities=caps,
        )


def require_capability(key: str):
    async def _dep(ctx: RequestContext = Depends(get_current_context)) -> RequestContext:
        if not ctx.capabilities.has(key, location_id=None):
            raise HTTPException(status_code=403, detail="You don't have permission to do that.")
        return ctx

    return _dep


async def idempotency_key_header(
    x_idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> str:
    if not x_idempotency_key or not (1 <= len(x_idempotency_key) <= 200):
        raise HTTPException(status_code=400, detail="An Idempotency-Key header is required.")
    return x_idempotency_key
