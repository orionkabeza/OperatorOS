"""The public pay-link API (spec D.6.5, plan §0.5).

Mounted at `/api/pay/{token}` -- NOT `/api/v1`, to keep it visually
distinct from the versioned, JWT-authenticated API despite living under
the same `/api` nginx routing prefix (see docs/DECISIONS.md "Same-origin
cutover: /pay path rename"). The customer-facing PAGE stays at
`/pay/{token}` in `apps/web` -- unrelated and unchanged; that page calls
this API from the browser.

`/api/pay/{token}` and its sibling actions are the FIRST of the two
places this phase intentionally opens a hole in the normal tenant-auth
wall (the second is the MoMo webhook, `api/routers/momo.py`) -- no
bearer token, no business_id header, nothing beyond the signed `token`
itself, which `security/tokens.py::decode_pay_link_token` verifies
before any database query runs (see that module and
models/paylink.py's docstrings, and docs/DECISIONS.md's "Pay-link tokens
are signed JWTs" entry). Every route here re-checks the referenced
`PayLink` row's LIVE status -- pending only -- on every call, so a
still-cryptographically-valid, not-yet-expired token stops working the
instant its link is paid or expires.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException

from operatoros_api.db import tenant_scoped_session
from operatoros_api.mobile_money import get_mobile_money_provider
from operatoros_api.models.customers import Customer
from operatoros_api.models.paylink import PayLink
from operatoros_api.models.tenancy import Business
from operatoros_api.schemas.pay import (
    PayLinkPageOut,
    PayLinkRequestPaymentOut,
    PayLinkRequestPaymentRequest,
    PayLinkStatusOut,
)
from operatoros_api.security.tokens import TokenError, decode_pay_link_token

router = APIRouter(prefix="/api/pay", tags=["pay"])


async def _resolve_live_pay_link(token: str) -> tuple[str, PayLink]:
    """Decodes+verifies the token, then re-checks the row's live status
    against `expires_at` (a link can be signature-valid but the DB row
    already expired/paid) -- returns `(business_id, pay_link)` or raises
    a generic 404 for every failure mode (bad signature, expired JWT,
    unknown/already-settled/expired row) so nothing about WHY a token
    doesn't work is distinguishable from the outside."""
    try:
        claims = decode_pay_link_token(token)
    except TokenError as exc:
        raise HTTPException(
            status_code=404, detail="This payment link is invalid or expired."
        ) from exc

    async with tenant_scoped_session(claims.business_id) as session:
        pay_link = await session.get(PayLink, claims.pay_link_id)
        if pay_link is None or pay_link.business_id != claims.business_id:
            raise HTTPException(status_code=404, detail="This payment link is invalid or expired.")
        if pay_link.status != "pending" or pay_link.expires_at < datetime.now(UTC):
            raise HTTPException(status_code=404, detail="This payment link is invalid or expired.")
        return claims.business_id, pay_link


@router.get("/{token}", response_model=PayLinkPageOut)
async def get_pay_link_page(token: str) -> PayLinkPageOut:
    business_id, pay_link = await _resolve_live_pay_link(token)
    async with tenant_scoped_session(business_id) as session:
        business = await session.get(Business, business_id)
        customer = await session.get(Customer, pay_link.customer_id)
        return PayLinkPageOut(
            business_name=business.name if business else "",
            customer_name=customer.name if customer else "",
            amount_minor=pay_link.amount_minor,
            status=pay_link.status,
            expires_at=pay_link.expires_at.isoformat(),
        )


@router.post("/{token}/request-payment", response_model=PayLinkRequestPaymentOut, status_code=201)
async def request_payment(
    token: str, body: PayLinkRequestPaymentRequest
) -> PayLinkRequestPaymentOut:
    """Kicks off the sandbox provider's simulated USSD push (plan §0.3/
    §0.5) against this pay link's amount. `momo_external_id` is stamped
    onto the row BEFORE the request is made so the settlement webhook
    (arriving seconds later, asynchronously) has something to match
    against -- see api/routers/momo.py::process_momo_webhook's pay-link
    settlement branch."""
    business_id, pay_link = await _resolve_live_pay_link(token)
    provider = get_mobile_money_provider()
    external_id = await provider.request_payment(
        business_id=business_id,
        phone=body.phone,
        amount_minor=pay_link.amount_minor,
        reference=f"paylink:{pay_link.id}",
    )
    async with tenant_scoped_session(business_id) as session:
        row = await session.get(PayLink, pay_link.id)
        if row is not None and row.status == "pending":
            row.provider = provider.provider_key
            row.momo_external_id = external_id
            await session.flush()
    return PayLinkRequestPaymentOut(status="pending", external_id=external_id)


@router.get("/{token}/status", response_model=PayLinkStatusOut)
async def get_pay_link_status(token: str) -> PayLinkStatusOut:
    """Polled by the pay-link page while waiting for the sandbox
    settlement to land -- deliberately re-resolves the live row rather
    than trusting anything cached client-side."""
    try:
        claims = decode_pay_link_token(token)
    except TokenError as exc:
        raise HTTPException(
            status_code=404, detail="This payment link is invalid or expired."
        ) from exc
    async with tenant_scoped_session(claims.business_id) as session:
        pay_link = await session.get(PayLink, claims.pay_link_id)
        if pay_link is None or pay_link.business_id != claims.business_id:
            raise HTTPException(status_code=404, detail="This payment link is invalid or expired.")
        return PayLinkStatusOut(
            status=pay_link.status,
            paid_at=pay_link.paid_at.isoformat() if pay_link.paid_at else None,
        )
