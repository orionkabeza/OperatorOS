"""Regression coverage for two security-review findings:

1. `Settings` must fail closed (refuse to start) if the insecure local-dev
   default `jwt_secret`/`secret_encryption_key` values are still in effect
   outside `env=local` -- previously this was a comment/TODO only, not
   enforced. See config.py::Settings._fail_closed_on_default_secrets_outside_local.
2. The MoMo sandbox provider and the logging notification sender must
   never write a raw phone number / recipient / subject to logs -- both
   now log a keyed hash (or length) instead. See
   mobile_money.py::SandboxMomoProvider.request_payment and
   notifications.py::LoggingNotificationSender.send.

These are plain unit tests -- no DB, no ASGI client -- so they run fast
and independently of the tenant-scoped fixtures the rest of the suite
uses.
"""

from __future__ import annotations

import pytest
import structlog.testing

from operatoros_api.config import Settings
from operatoros_api.mobile_money import SandboxMomoProvider
from operatoros_api.notifications import LoggingNotificationSender
from operatoros_api.security.identifiers import hash_identifier


def test_local_env_is_allowed_to_use_the_default_secrets() -> None:
    settings = Settings(env="local")
    assert settings.jwt_secret
    assert settings.secret_encryption_key


@pytest.mark.parametrize("env", ["production", "staging", "prod"])
def test_non_local_env_refuses_to_start_with_default_jwt_secret(env: str) -> None:
    with pytest.raises(ValueError, match="OPERATOROS_JWT_SECRET"):
        Settings(env=env, secret_encryption_key="a-real-per-environment-key-not-the-default==")


@pytest.mark.parametrize("env", ["production", "staging", "prod"])
def test_non_local_env_refuses_to_start_with_default_encryption_key(env: str) -> None:
    with pytest.raises(ValueError, match="OPERATOROS_SECRET_ENCRYPTION_KEY"):
        Settings(env=env, jwt_secret="a-real-per-environment-jwt-secret-not-the-default")


def test_non_local_env_starts_fine_once_both_secrets_are_overridden() -> None:
    settings = Settings(
        env="production",
        jwt_secret="a-real-per-environment-jwt-secret-not-the-default",
        secret_encryption_key="a-real-per-environment-key-not-the-default==",
    )
    assert settings.env == "production"


@pytest.mark.asyncio
async def test_momo_sandbox_request_payment_never_logs_the_raw_phone_number(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _fake_apply_async(**_kwargs: object) -> None:
        return None

    class _FakeTask:
        @staticmethod
        def apply_async(*, kwargs: dict, countdown: int) -> None:
            return None

    monkeypatch.setattr("operatoros_api.tasks.momo_settlement.simulate_settlement", _FakeTask())

    phone = "+250788123456"
    with structlog.testing.capture_logs() as captured:
        await SandboxMomoProvider().request_payment(
            business_id="biz-1", phone=phone, amount_minor=1000, reference="ref-1"
        )

    events = [e for e in captured if e.get("event") == "momo_sandbox_payment_requested"]
    assert events, "expected a momo_sandbox_payment_requested log event"
    logged = events[0]
    assert phone not in repr(logged)
    assert logged["phone_hash"] == hash_identifier(phone)


@pytest.mark.asyncio
async def test_logging_notification_sender_never_logs_the_raw_recipient_or_subject() -> None:
    to = "+250788999999"
    subject = "Payment received for invoice #4821"
    with structlog.testing.capture_logs() as captured:
        await LoggingNotificationSender().send(
            channel="whatsapp", to=to, subject=subject, body="irrelevant body"
        )

    events = [e for e in captured if e.get("event") == "notification_sent_stub"]
    assert events, "expected a notification_sent_stub log event"
    logged = events[0]
    assert to not in repr(logged)
    assert subject not in repr(logged)
    assert logged["to_hash"] == hash_identifier(to)
    assert logged["subject_length"] == len(subject)
