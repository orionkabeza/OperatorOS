"""The nightly projection-audit job (spec E.3): recompute
money_location_balance from the event log and diff it against the live
projection.

Two tests:

1. `test_audit_detects_injected_drift` calls the async core
   (`run_audit_async`) directly, in-process, and asserts it detects a
   discrepancy we inject on purpose. Drift is injected the same way the
   projection framework itself is allowed to write -- by setting
   `app.projection_writer = true` for one connection before issuing a raw
   UPDATE -- so this test doesn't fight the trigger proven in
   test_projection_trigger.py, it uses the one legitimate back door to
   simulate "the live projection and the event log disagree" without
   needing a second, contradictory code path.

2. `test_audit_task_entrypoint_fails_in_a_real_worker_like_process` invokes
   the actual Celery task callable (`run_projection_audit`, the thing a
   worker would call) in a genuinely separate Python process pointed at
   the same test database. This matters because the task wraps its async
   body in `asyncio.run(...)` -- correct for a real Celery worker (no
   event loop already running) but incompatible with calling it directly
   from inside this async test suite's shared loop. A subprocess sidesteps
   that entirely and is arguably the more faithful test anyway: it's
   exactly what `celery ... worker` would execute.
"""

from __future__ import annotations

import os
import subprocess
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text

from operatoros_api.db import tenant_scoped_session
from operatoros_api.ledger import EventEnvelopeInput, append_event
from operatoros_api.tasks.projection_audit import run_audit_async
from tests.conftest import SeededTenant

APPS_API_DIR = Path(__file__).resolve().parents[1]
VENV_PYTHON = APPS_API_DIR / ".venv" / "Scripts" / "python.exe"


async def _inject_drift(tenant: SeededTenant, delta_minor: int) -> None:
    async with tenant_scoped_session(tenant.business.id) as session:
        await session.execute(text("SET LOCAL app.projection_writer = 'true'"))
        await session.execute(
            text(
                "UPDATE money_location_balance SET balance_minor = balance_minor + :delta "
                "WHERE business_id = :bid AND location_id = :lid AND account_key = 'till'"
            ),
            {"delta": delta_minor, "bid": tenant.business.id, "lid": tenant.location.id},
        )


@pytest.mark.asyncio
async def test_audit_passes_clean_when_projection_matches_the_ledger(tenant_a: SeededTenant) -> None:
    async with tenant_scoped_session(tenant_a.business.id) as session:
        await append_event(
            session,
            EventEnvelopeInput(
                business_id=tenant_a.business.id,
                type="EXPENSE_RECORDED",
                payload={"amount_minor": 20000, "category": "Transport", "money_location": "till"},
                actor_user_id=tenant_a.owner.id,
                actor_source="api",
                location_id=tenant_a.location.id,
                correlation_id=str(uuid.uuid4()),
            ),
        )

    drifts = await run_audit_async()
    my_drifts = [d for d in drifts if d["business_id"] == tenant_a.business.id]
    assert my_drifts == []


@pytest.mark.asyncio
async def test_audit_detects_injected_drift(tenant_a: SeededTenant) -> None:
    async with tenant_scoped_session(tenant_a.business.id) as session:
        await append_event(
            session,
            EventEnvelopeInput(
                business_id=tenant_a.business.id,
                type="EXPENSE_RECORDED",
                payload={"amount_minor": 30000, "category": "Repairs", "money_location": "till"},
                actor_user_id=tenant_a.owner.id,
                actor_source="api",
                location_id=tenant_a.location.id,
                correlation_id=str(uuid.uuid4()),
            ),
        )

    # Sabotage the live projection so it disagrees with the event log by
    # exactly 777700 minor units.
    await _inject_drift(tenant_a, 777700)

    drifts = await run_audit_async()
    my_drifts = [d for d in drifts if d["business_id"] == tenant_a.business.id]
    assert len(my_drifts) == 1, drifts
    drift = my_drifts[0]
    assert drift["location_id"] == tenant_a.location.id
    assert drift["account_key"] == "till"
    assert drift["actual_minor"] - drift["expected_minor"] == 777700


async def _seed_event_and_drift_for_subprocess_test(tenant: SeededTenant) -> None:
    async with tenant_scoped_session(tenant.business.id) as session:
        await append_event(
            session,
            EventEnvelopeInput(
                business_id=tenant.business.id,
                type="EXPENSE_RECORDED",
                payload={"amount_minor": 5000, "category": "Airtime", "money_location": "till"},
                actor_user_id=tenant.owner.id,
                actor_source="api",
                location_id=tenant.location.id,
                correlation_id=str(uuid.uuid4()),
            ),
        )
    await _inject_drift(tenant, 12300)


@pytest.mark.asyncio
async def test_audit_task_subprocess_exits_nonzero_on_drift(
    tenant_a: SeededTenant, postgres_urls: dict[str, str]
) -> None:
    await _seed_event_and_drift_for_subprocess_test(tenant_a)

    script = (
        "from operatoros_api.tasks.projection_audit import run_projection_audit\n"
        "run_projection_audit()\n"
    )
    result = subprocess.run(
        [str(VENV_PYTHON), "-c", script],
        cwd=str(APPS_API_DIR),
        env={
            **os.environ,
            "OPERATOROS_DATABASE_URL": postgres_urls["app_async"],
            "OPERATOROS_REDIS_URL": "redis://localhost:6379/0",
        },
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode != 0, f"expected the task to fail; stdout={result.stdout} stderr={result.stderr}"
    assert "ProjectionDrift" in result.stderr, result.stderr
