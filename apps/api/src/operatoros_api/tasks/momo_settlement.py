"""The sandbox MoMo provider's simulated settlement callback (plan §0.3).

`mobile_money.py::SandboxMomoProvider.request_payment` schedules
`simulate_settlement` a few seconds in the future to play the role of "the
customer approved the USSD prompt, and the provider is now telling us
about it." What's real here: the HMAC signature is computed with the
tenant's actual stored secret (decrypted the same way a real inbound
webhook's verification would decrypt it to CHECK a signature -- here it's
used to CREATE one, the same key, the other direction), the payload shape
and header names are exactly what `api/routers/momo.py::momo_webhook`
expects, and `process_momo_webhook` -- the identical function the HTTP
route calls -- performs full signature/replay verification against it, no
bypass.

What's simulated: this task calls `process_momo_webhook` as a direct
in-process function call rather than over a real HTTP round trip to a
running server. A real provider's webhook would be an actual inbound
HTTP request from outside our network; there is no second "provider"
process here to make that request from, and standing one up purely so a
sandbox could call itself over a socket would be complexity with no
security benefit -- the verification code path (signature check, replay-
nonce claim, idempotent transaction landing) is byte-for-byte the same
either way. Disclosed here and in docs/DECISIONS.md rather than silently
presented as a full network round trip.
"""

from __future__ import annotations

import json
import time
import uuid

import structlog

from operatoros_api.db import tenant_scoped_session
from operatoros_api.models.momo import MomoProviderCredential
from operatoros_api.security.crypto import decrypt_secret
from operatoros_api.security.webhooks import compute_signature
from operatoros_api.tasks.celery_app import celery_app

logger = structlog.get_logger("operatoros_api.momo_settlement")


async def _run_settlement(
    *,
    business_id: str,
    provider: str,
    external_id: str,
    phone: str,
    amount_minor: int,
    reference: str,
) -> None:
    from operatoros_api.api.routers.momo import WebhookRejected, process_momo_webhook

    async with tenant_scoped_session(business_id) as session:
        from sqlalchemy import select

        cred_result = await session.execute(
            select(MomoProviderCredential).where(
                MomoProviderCredential.business_id == business_id,
                MomoProviderCredential.provider == provider,
                MomoProviderCredential.status == "connected",
            )
        )
        cred = cred_result.scalar_one_or_none()
        if cred is None:
            logger.error(
                "momo_sandbox_settlement_no_credentials", business_id=business_id, provider=provider
            )
            return
        secret = decrypt_secret(cred.encrypted_secret)

    payload = {
        "business_id": business_id,
        "external_id": external_id,
        "phone": phone,
        "amount_minor": amount_minor,
        "direction": "in",
        "reference": reference,
    }
    raw_body = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    timestamp = str(time.time())
    nonce = uuid.uuid4().hex
    signature = compute_signature(secret, timestamp, nonce, raw_body)
    headers = {
        "x-momo-timestamp": timestamp,
        "x-momo-nonce": nonce,
        "x-momo-signature": signature,
    }

    try:
        result = await process_momo_webhook(provider, raw_body, headers)
    except WebhookRejected as exc:
        logger.error(
            "momo_sandbox_settlement_rejected",
            business_id=business_id,
            external_id=external_id,
            detail=exc.detail,
        )
        return
    logger.info(
        "momo_sandbox_settlement_processed",
        business_id=business_id,
        external_id=external_id,
        result=result,
    )


@celery_app.task(name="operatoros_api.tasks.momo_settlement.simulate_settlement")
def simulate_settlement(
    *, business_id: str, external_id: str, phone: str, amount_minor: int, reference: str
) -> None:
    import asyncio

    from operatoros_api.mobile_money import SANDBOX_PROVIDER_KEY

    asyncio.run(
        _run_settlement(
            business_id=business_id,
            provider=SANDBOX_PROVIDER_KEY,
            external_id=external_id,
            phone=phone,
            amount_minor=amount_minor,
            reference=reference,
        )
    )
