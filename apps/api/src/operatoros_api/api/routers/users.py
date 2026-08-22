"""Demo tenant-scoped resource endpoints.

Phase 0 has no real staff-management feature (that's later phases), but
the cross-tenant isolation suite (spec G.1's build-failing requirement)
needs *some* real, RLS-and-capability-protected CRUD surface to attack.
These endpoints are that surface: minimal, real, and exercised end-to-end
by tests/test_cross_tenant_isolation.py and tests/test_idempotency.py.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select

from operatoros_api.api.deps import (
    RequestContext,
    get_current_context,
    idempotency_key_header,
    require_capability,
)
from operatoros_api.audit_log import append_audit_log
from operatoros_api.capabilities import CAPABILITIES
from operatoros_api.idempotency_service import (
    claim_or_replay,
    complete,
    fingerprint_request,
    get_existing,
)
from operatoros_api.models.tenancy import (
    Permission,
    Role,
    RolePermission,
    User,
    UserGrant,
    UserLocation,
)
from operatoros_api.schemas.users import (
    ApproverOut,
    GrantRequest,
    MeOut,
    RoleChangeRequest,
    UserCreateRequest,
    UserOut,
)
from operatoros_api.security.identifiers import hash_identifier
from operatoros_api.security.passwords import hash_secret

router = APIRouter(prefix="/api/v1/users", tags=["users"])


def _to_user_out(user: User, role_key: str) -> UserOut:
    return UserOut(
        id=user.id,
        display_name=user.display_name,
        phone=user.phone,
        email=user.email,
        role_key=role_key,
        status=user.status,
    )


@router.get("/me", response_model=MeOut)
async def get_me(ctx: RequestContext = Depends(get_current_context)) -> MeOut:
    user = await ctx.session.get(User, ctx.user_id)
    if user is None:
        # get_current_context just loaded this exact row moments earlier in
        # the same transaction -- unreachable in practice. An explicit
        # raise, not `assert` (bandit B101: stripped under `python -O`).
        raise RuntimeError("authenticated user row disappeared mid-request")
    return MeOut(
        id=ctx.user_id,
        business_id=ctx.business_id,
        display_name=user.display_name,
        role_key=ctx.role_key,
        location_ids=ctx.location_ids,
    )


@router.get("", response_model=list[UserOut])
async def list_users(
    ctx: RequestContext = Depends(require_capability("user.manage")),
) -> list[UserOut]:
    result = await ctx.session.execute(select(User))
    return [_to_user_out(u, u.role.key) for u in result.scalars()]


@router.get("/approvers", response_model=list[ApproverOut])
async def list_approvers(
    capability: str,
    ctx: RequestContext = Depends(get_current_context),
) -> list[ApproverOut]:
    """Who can approve an override that the current user isn't allowed to
    make alone -- a discount above the threshold, a credit-limit override, a
    back-dated payment.

    `sales.py::_verify_manager_override` needs BOTH a manager's user id and
    that manager's PIN, so the Counter has to be able to name the approver.
    `GET /users` can't serve that: it requires `user.manage`, which a
    cashier deliberately does not have, so the frontend previously sent
    `manager_override_user_id: null` and every over-threshold sale failed
    422 no matter what PIN was typed.

    Deliberately NOT capability-gated beyond being authenticated: a cashier
    must be able to see who to ask. It returns only id and display name --
    no phone, no email, no role listing -- for active users in the caller's
    own business who hold the specific capability being requested. That is
    strictly less than the shop's own staff already know about each other.
    """
    if capability not in CAPABILITIES:
        raise HTTPException(status_code=422, detail="Unknown capability.")

    result = await ctx.session.execute(
        select(User)
        .join(RolePermission, RolePermission.role_id == User.role_id)
        .join(Permission, Permission.id == RolePermission.permission_id)
        .where(User.status == "active", Permission.key == capability)
        .order_by(User.display_name)
    )
    # `User.role` is lazy="joined", so the row set can repeat a user.
    return [
        ApproverOut(id=u.id, display_name=u.display_name) for u in result.scalars().unique()
    ]


@router.get("/{user_id}", response_model=UserOut)
async def get_user(
    user_id: str, ctx: RequestContext = Depends(require_capability("user.manage"))
) -> UserOut:
    user = await ctx.session.get(User, user_id)
    if user is None:
        # RLS already guarantees a business-B id returns nothing here --
        # this 404 is the *only* thing a cross-tenant caller ever sees.
        raise HTTPException(status_code=404, detail="Not found.")
    return _to_user_out(user, user.role.key)


@router.post("", response_model=UserOut, status_code=201)
async def create_user(
    body: UserCreateRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("user.manage")),
) -> UserOut:
    raw_body = await request.body()
    fingerprint = fingerprint_request("POST", "/api/v1/users", ctx.business_id, raw_body)
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint="POST /api/v1/users",
        fingerprint=fingerprint,
    )
    if claimed_id is None:
        existing = await get_existing(ctx.session, business_id=ctx.business_id, key=idempotency_key)
        if existing.request_fingerprint != fingerprint:
            raise HTTPException(
                status_code=409,
                detail="This Idempotency-Key was already used for a different request.",
            )
        if existing.response_body is None:
            # See idempotency_service.py's module docstring: a row reached
            # via claim_or_replay's "conflict" branch is guaranteed complete
            # by Postgres's own locking behaviour. Not `assert` (bandit
            # B101: stripped under `python -O`) -- an explicit raise here
            # survives that and still becomes a generic, logged 500.
            raise RuntimeError("idempotency row has no response_body despite being complete")
        return UserOut(**existing.response_body)

    role_result = await ctx.session.execute(
        select(Role).where(Role.business_id == ctx.business_id, Role.key == body.role_key)
    )
    role = role_result.scalar_one_or_none()
    if role is None:
        raise HTTPException(status_code=422, detail="Unknown role.")

    user = User(
        business_id=ctx.business_id,
        role_id=role.id,
        display_name=body.display_name,
        phone=body.phone,
        phone_hash=hash_identifier(body.phone) if body.phone else None,
        email=body.email,
        email_hash=hash_identifier(body.email) if body.email else None,
        auth_mode="pin",
        secret_hash=hash_secret(body.secret),
        status="active",
    )
    ctx.session.add(user)
    await ctx.session.flush()

    for location_id in body.location_ids:
        ctx.session.add(
            UserLocation(business_id=ctx.business_id, user_id=user.id, location_id=location_id)
        )

    out = _to_user_out(user, role.key)
    await complete(ctx.session, claimed_id=claimed_id, status_code=201, body=out.model_dump())
    return out


@router.post("/{user_id}/role", response_model=UserOut)
async def change_user_role(
    user_id: str,
    body: RoleChangeRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("role.manage")),
) -> UserOut:
    """Writes a ROLE_CHANGED audit_log entry (spec G.1 / approved plan §6).
    This is deliberately minimal -- no feature UI calls it yet -- but it's
    a real, capability-gated, RLS-protected mutation, not a stub: it's how
    the audit log actually receives a ROLE_CHANGED event rather than one
    only ever asserted about in a unit test.
    """
    raw_body = await request.body()
    fingerprint = fingerprint_request(
        "POST", f"/api/v1/users/{user_id}/role", ctx.business_id, raw_body
    )
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint="POST /api/v1/users/{user_id}/role",
        fingerprint=fingerprint,
    )
    if claimed_id is None:
        existing = await get_existing(ctx.session, business_id=ctx.business_id, key=idempotency_key)
        if existing.request_fingerprint != fingerprint:
            raise HTTPException(
                status_code=409,
                detail="This Idempotency-Key was already used for a different request.",
            )
        if existing.response_body is None:
            # See idempotency_service.py's module docstring: a row reached
            # via claim_or_replay's "conflict" branch is guaranteed complete
            # by Postgres's own locking behaviour. Not `assert` (bandit
            # B101: stripped under `python -O`) -- an explicit raise here
            # survives that and still becomes a generic, logged 500.
            raise RuntimeError("idempotency row has no response_body despite being complete")
        return UserOut(**existing.response_body)

    user = await ctx.session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Not found.")

    new_role_result = await ctx.session.execute(
        select(Role).where(Role.business_id == ctx.business_id, Role.key == body.role_key)
    )
    new_role = new_role_result.scalar_one_or_none()
    if new_role is None:
        raise HTTPException(status_code=422, detail="Unknown role.")

    old_role_key = user.role.key
    user.role_id = new_role.id
    await ctx.session.flush()
    await append_audit_log(
        ctx.session,
        business_id=ctx.business_id,
        event_type="ROLE_CHANGED",
        actor_user_id=ctx.user_id,
        subject_user_id=user.id,
        detail={"old_role_key": old_role_key, "new_role_key": new_role.key},
    )

    out = _to_user_out(user, new_role.key)
    await complete(ctx.session, claimed_id=claimed_id, status_code=200, body=out.model_dump())
    return out


@router.post("/{user_id}/grants", response_model=UserOut, status_code=201)
async def override_user_permission(
    user_id: str,
    body: GrantRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("role.manage")),
) -> UserOut:
    """Writes a PERMISSION_OVERRIDDEN audit_log entry -- the per-user
    grant/revoke layer described in capabilities.py, exposed as a real
    (if minimal) endpoint so it's exercised end-to-end rather than only
    at the function level."""
    if body.effect not in ("grant", "revoke"):
        raise HTTPException(status_code=422, detail="effect must be 'grant' or 'revoke'.")

    raw_body = await request.body()
    fingerprint = fingerprint_request(
        "POST", f"/api/v1/users/{user_id}/grants", ctx.business_id, raw_body
    )
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint="POST /api/v1/users/{user_id}/grants",
        fingerprint=fingerprint,
    )
    if claimed_id is None:
        existing = await get_existing(ctx.session, business_id=ctx.business_id, key=idempotency_key)
        if existing.request_fingerprint != fingerprint:
            raise HTTPException(
                status_code=409,
                detail="This Idempotency-Key was already used for a different request.",
            )
        if existing.response_body is None:
            # See idempotency_service.py's module docstring: a row reached
            # via claim_or_replay's "conflict" branch is guaranteed complete
            # by Postgres's own locking behaviour. Not `assert` (bandit
            # B101: stripped under `python -O`) -- an explicit raise here
            # survives that and still becomes a generic, logged 500.
            raise RuntimeError("idempotency row has no response_body despite being complete")
        return UserOut(**existing.response_body)

    user = await ctx.session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Not found.")

    ctx.session.add(
        UserGrant(
            business_id=ctx.business_id,
            user_id=user.id,
            permission_key=body.permission_key,
            effect=body.effect,
            location_id=body.location_id,
            created_by_user_id=ctx.user_id,
        )
    )
    await ctx.session.flush()
    await append_audit_log(
        ctx.session,
        business_id=ctx.business_id,
        event_type="PERMISSION_OVERRIDDEN",
        actor_user_id=ctx.user_id,
        subject_user_id=user.id,
        detail={
            "permission_key": body.permission_key,
            "effect": body.effect,
            "location_id": body.location_id,
        },
    )

    out = _to_user_out(user, user.role.key)
    await complete(ctx.session, claimed_id=claimed_id, status_code=201, body=out.model_dump())
    return out
