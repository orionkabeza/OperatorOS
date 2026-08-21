"""Mobile-money provider seam (plan §0.3), built to the same standard as
`notifications.py`'s `NotificationSender`: a real `Protocol` with one
sandbox-backed implementation, so a real MTN MoMo / Airtel Money
integration is a later-phase seam-swap, not a rewrite.

`SandboxMomoProvider.request_payment` simulates a customer approving a
USSD push a few seconds after being asked -- a pending settlement is
scheduled on Celery (`tasks/momo_settlement.py::simulate_settlement`),
which then calls back through the exact same signed, replay-protected
`POST /api/v1/momo/webhook/{provider}` endpoint a real provider's webhook
would hit (see `api/routers/momo.py` and
`security/webhooks.py`/docs/DECISIONS.md for the signature/tenant-
identification design). Only the provider on the other end is fake --
nothing about the webhook path is a shortcut.
"""

from __future__ import annotations

from typing import Protocol

import structlog

from operatoros_api.security.identifiers import hash_identifier

logger = structlog.get_logger("operatoros_api.mobile_money")

SANDBOX_PROVIDER_KEY = "sandbox_momo"
# How long after `request_payment` the sandbox "customer" approves the
# USSD prompt. A few seconds, per plan §0.3 ("settles a simulated
# transaction a few seconds after request_payment is called") -- long
# enough to be visibly asynchronous in a demo, short enough not to make
# manual testing tedious.
SANDBOX_SETTLEMENT_DELAY_SECONDS = 5


class MobileMoneyProvider(Protocol):
    provider_key: str

    async def connect(self, *, business_id: str, merchant_ref: str | None) -> str:
        """Establishes a connection for this tenant; returns the plaintext
        shared secret to be encrypted and stored
        (`security/crypto.py::encrypt_secret`) for future signature
        use. A real provider would perform some kind of API handshake
        here; the sandbox just mints a random secret."""
        ...

    async def request_payment(
        self, *, business_id: str, phone: str, amount_minor: int, reference: str
    ) -> str:
        """Initiates a payment request (e.g. a USSD push). Returns an
        opaque `external_id` the eventual settlement webhook will
        reference."""
        ...


class SandboxMomoProvider:
    provider_key = SANDBOX_PROVIDER_KEY

    async def connect(self, *, business_id: str, merchant_ref: str | None) -> str:
        import secrets

        secret = secrets.token_hex(32)
        logger.info("momo_sandbox_connected", business_id=business_id, merchant_ref=merchant_ref)
        return secret

    async def request_payment(
        self, *, business_id: str, phone: str, amount_minor: int, reference: str
    ) -> str:
        import uuid

        from operatoros_api.tasks.momo_settlement import simulate_settlement

        external_id = f"sandbox-{uuid.uuid4().hex}"
        logger.info(
            "momo_sandbox_payment_requested",
            business_id=business_id,
            phone_hash=hash_identifier(phone),
            amount_minor=amount_minor,
            external_id=external_id,
        )
        simulate_settlement.apply_async(
            kwargs={
                "business_id": business_id,
                "external_id": external_id,
                "phone": phone,
                "amount_minor": amount_minor,
                "reference": reference,
            },
            countdown=SANDBOX_SETTLEMENT_DELAY_SECONDS,
        )
        return external_id


_provider: MobileMoneyProvider = SandboxMomoProvider()


def get_mobile_money_provider() -> MobileMoneyProvider:
    return _provider
