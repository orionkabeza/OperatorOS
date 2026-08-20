"""The hash-chained audit log (spec G.1 "Auditing"; approved plan §6).

Covers: a clean chain verifies; a mutated middle row fails verification
(the specific proof the brief asks for); and that LOGIN_SUCCEEDED /
LOGIN_FAILED / ROLE_CHANGED / PERMISSION_OVERRIDDEN actually flow in from
the real HTTP endpoints, not just from direct unit calls to
append_audit_log.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import create_engine, select, text

from operatoros_api.audit_log import GENESIS_HASH, append_audit_log, verify_chain
from operatoros_api.db import tenant_scoped_session
from operatoros_api.models.audit_log import AuditLogEntry
from tests.conftest import SeededTenant
from tests.helpers import auth_headers, idempotency_headers


@pytest.mark.asyncio
async def test_chain_verifies_over_a_clean_sequence(tenant_a: SeededTenant) -> None:
    async with tenant_scoped_session(tenant_a.business.id) as session:
        e1 = await append_audit_log(
            session,
            business_id=tenant_a.business.id,
            event_type="LOGIN_SUCCEEDED",
            actor_user_id=tenant_a.owner.id,
            detail={"device_id": "d1"},
        )
        e2 = await append_audit_log(
            session,
            business_id=tenant_a.business.id,
            event_type="ROLE_CHANGED",
            actor_user_id=tenant_a.owner.id,
            subject_user_id=tenant_a.owner.id,
            detail={"old_role_key": "cashier", "new_role_key": "manager"},
        )
        e3 = await append_audit_log(
            session,
            business_id=tenant_a.business.id,
            event_type="DATA_EXPORTED",
            actor_user_id=tenant_a.owner.id,
            detail={"export_type": "sales_csv", "row_count": 42},
        )

    assert e1.seq == 1
    assert e1.prev_hash == GENESIS_HASH
    assert e2.prev_hash == e1.hash
    assert e3.prev_hash == e2.hash

    async with tenant_scoped_session(tenant_a.business.id) as session:
        result = await verify_chain(session, business_id=tenant_a.business.id)
    assert result.ok
    assert result.broken_at_seq is None


@pytest.mark.asyncio
async def test_a_mutated_middle_row_fails_verification(
    tenant_a: SeededTenant, postgres_urls: dict[str, str]
) -> None:
    async with tenant_scoped_session(tenant_a.business.id) as session:
        await append_audit_log(
            session,
            business_id=tenant_a.business.id,
            event_type="LOGIN_SUCCEEDED",
            actor_user_id=tenant_a.owner.id,
            detail={"device_id": "d1"},
        )
        target = await append_audit_log(
            session,
            business_id=tenant_a.business.id,
            event_type="ROLE_CHANGED",
            actor_user_id=tenant_a.owner.id,
            subject_user_id=tenant_a.owner.id,
            detail={"old_role_key": "cashier", "new_role_key": "manager"},
        )
        await append_audit_log(
            session,
            business_id=tenant_a.business.id,
            event_type="LOGIN_SUCCEEDED",
            actor_user_id=tenant_a.owner.id,
            detail={"device_id": "d2"},
        )

    # A direct, out-of-band edit -- deliberately bypassing the app's own
    # role entirely (operatoros_app has no UPDATE grant on audit_log at
    # all, per migration 0004) by using the raw admin connection. This is
    # exactly the class of tamper the hash chain exists to catch: someone
    # with direct database access editing history, not a bug in the API.
    admin_engine = create_engine(postgres_urls["admin"])
    with admin_engine.connect() as conn:
        conn.execute(
            text("UPDATE audit_log SET detail = CAST(:d AS JSONB) WHERE id = :id"),
            {"d": '{"old_role_key": "cashier", "new_role_key": "owner"}', "id": target.id},
        )
        conn.commit()
    admin_engine.dispose()

    async with tenant_scoped_session(tenant_a.business.id) as session:
        result = await verify_chain(session, business_id=tenant_a.business.id)

    assert not result.ok
    assert result.broken_at_seq == target.seq
    assert "hash mismatch" in result.reason


@pytest.mark.asyncio
async def test_operatoros_app_cannot_update_audit_log_rows_at_all(
    tenant_a: SeededTenant,
) -> None:
    """Belt and suspenders: even before the hash chain would catch it, the
    ordinary app role's UPDATE grant on audit_log doesn't exist (migration
    0004) -- a bug in the application code can't silently rewrite history
    even if it tried, independent of remembering to check the chain."""
    from sqlalchemy.exc import DBAPIError

    async with tenant_scoped_session(tenant_a.business.id) as session:
        entry = await append_audit_log(
            session,
            business_id=tenant_a.business.id,
            event_type="LOGIN_SUCCEEDED",
            actor_user_id=tenant_a.owner.id,
            detail={"device_id": "d1"},
        )

    with pytest.raises(DBAPIError):
        async with tenant_scoped_session(tenant_a.business.id) as session:
            await session.execute(
                text("UPDATE audit_log SET event_type = 'LOGIN_FAILED' WHERE id = :id"),
                {"id": entry.id},
            )


@pytest.mark.asyncio
async def test_successful_login_writes_a_login_succeeded_audit_entry(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    tokens_resp = await client.post(
        "/api/v1/auth/login",
        json={
            "business_slug": tenant_a.business.slug,
            "identifier": tenant_a.owner_phone,
            "secret": tenant_a.owner_secret,
            "device_id": f"device-{uuid.uuid4().hex[:8]}",
        },
    )
    assert tokens_resp.status_code == 200

    async with tenant_scoped_session(tenant_a.business.id) as session:
        result = await session.execute(
            select(AuditLogEntry).where(
                AuditLogEntry.business_id == tenant_a.business.id,
                AuditLogEntry.event_type == "LOGIN_SUCCEEDED",
            )
        )
        entries = result.scalars().all()
    assert len(entries) == 1
    assert entries[0].actor_user_id == tenant_a.owner.id


@pytest.mark.asyncio
async def test_failed_login_writes_a_login_failed_audit_entry(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    resp = await client.post(
        "/api/v1/auth/login",
        json={
            "business_slug": tenant_a.business.slug,
            "identifier": tenant_a.owner_phone,
            "secret": "definitely-wrong",
            "device_id": f"device-{uuid.uuid4().hex[:8]}",
        },
    )
    assert resp.status_code == 401

    async with tenant_scoped_session(tenant_a.business.id) as session:
        result = await session.execute(
            select(AuditLogEntry).where(
                AuditLogEntry.business_id == tenant_a.business.id,
                AuditLogEntry.event_type == "LOGIN_FAILED",
            )
        )
        entries = result.scalars().all()
    assert len(entries) == 1


@pytest.mark.asyncio
async def test_role_change_endpoint_writes_a_role_changed_audit_entry(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    from operatoros_api.seed import create_user

    async with tenant_scoped_session(tenant_a.business.id) as session:
        target = await create_user(
            session,
            business_id=tenant_a.business.id,
            role=tenant_a.roles["cashier"],
            display_name="Future Manager",
            secret="662211",
            phone="+250788555000",
            location_ids=[tenant_a.location.id],
        )
        target_id = target.id

    headers = await auth_headers(client, tenant_a)
    resp = await client.post(
        f"/api/v1/users/{target_id}/role",
        headers={**headers, **idempotency_headers()},
        json={"role_key": "manager"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["role_key"] == "manager"

    async with tenant_scoped_session(tenant_a.business.id) as session:
        result = await session.execute(
            select(AuditLogEntry).where(
                AuditLogEntry.business_id == tenant_a.business.id,
                AuditLogEntry.event_type == "ROLE_CHANGED",
            )
        )
        entries = result.scalars().all()
    assert len(entries) == 1
    assert entries[0].subject_user_id == target_id
    assert entries[0].detail == {"old_role_key": "cashier", "new_role_key": "manager"}


@pytest.mark.asyncio
async def test_grant_endpoint_writes_a_permission_overridden_audit_entry(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    resp = await client.post(
        f"/api/v1/users/{tenant_a.owner.id}/grants",
        headers={**headers, **idempotency_headers()},
        json={"permission_key": "debt.write_off", "effect": "revoke", "location_id": None},
    )
    assert resp.status_code == 201, resp.text

    async with tenant_scoped_session(tenant_a.business.id) as session:
        result = await session.execute(
            select(AuditLogEntry).where(
                AuditLogEntry.business_id == tenant_a.business.id,
                AuditLogEntry.event_type == "PERMISSION_OVERRIDDEN",
            )
        )
        entries = result.scalars().all()
    assert len(entries) == 1
    assert entries[0].detail["permission_key"] == "debt.write_off"
    assert entries[0].detail["effect"] == "revoke"


@pytest.mark.asyncio
async def test_audit_log_chain_is_isolated_per_tenant(
    tenant_a: SeededTenant, tenant_b: SeededTenant
) -> None:
    async with tenant_scoped_session(tenant_a.business.id) as session:
        a_entry = await append_audit_log(
            session,
            business_id=tenant_a.business.id,
            event_type="LOGIN_SUCCEEDED",
            actor_user_id=tenant_a.owner.id,
            detail={},
        )
    async with tenant_scoped_session(tenant_b.business.id) as session:
        b_entry = await append_audit_log(
            session,
            business_id=tenant_b.business.id,
            event_type="LOGIN_SUCCEEDED",
            actor_user_id=tenant_b.owner.id,
            detail={},
        )

    # Each tenant's chain starts fresh from GENESIS_HASH -- one tenant's
    # audit history is not observable, and does not influence the hash
    # chain, of another's (RLS also proven separately in
    # test_rls_isolation.py / test_cross_tenant_isolation.py).
    assert a_entry.seq == 1
    assert b_entry.seq == 1
    assert a_entry.prev_hash == GENESIS_HASH == b_entry.prev_hash
