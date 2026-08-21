"""Mobile-money staging, reconciliation, and the signed webhook receiver
(spec D.7.3, plan §0.3/§3).

`process_momo_webhook` is the one function both the public
`POST /api/v1/momo/webhook/{provider}` route AND
`tasks/momo_settlement.py::simulate_settlement` (the sandbox's simulated
provider callback) call -- the same processing path, same verification,
regardless of whether the caller is a real HTTP request or the sandbox
task playing the role of the provider in-process. See that task's module
docstring for exactly what's real vs. simulated here, and
docs/DECISIONS.md's "MoMo webhook tenant identification" entry for why
`business_id` is a body claim verified by signature rather than a path
segment.
"""

from __future__ import annotations

import csv
import io
import json
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from operatoros_api.api.deps import RequestContext, idempotency_key_header, require_capability
from operatoros_api.db import tenant_scoped_session
from operatoros_api.debt_ageing import auto_allocate, open_invoices_for_customer
from operatoros_api.idempotency_service import (
    claim_or_replay,
    complete,
    fingerprint_request,
    get_existing,
)
from operatoros_api.ledger import EnvelopeValidationError, EventEnvelopeInput, append_event
from operatoros_api.mobile_money import get_mobile_money_provider
from operatoros_api.models.customers import Customer
from operatoros_api.models.momo import MomoProviderCredential, MomoTransaction, MomoWebhookNonce
from operatoros_api.models.paylink import PayLink
from operatoros_api.models.payments import PaymentAllocation
from operatoros_api.schemas.momo import (
    MomoConnectOut,
    MomoConnectRequest,
    MomoImportResultOut,
    MomoMatchOut,
    MomoMatchRequest,
    MomoMatchSuggestionOut,
    MomoTransactionOut,
)
from operatoros_api.security.crypto import decrypt_secret, encrypt_secret
from operatoros_api.security.webhooks import timestamp_within_window, verify_signature

router = APIRouter(prefix="/api/v1/momo", tags=["momo"])

MATCH_TIME_WINDOW_HOURS = 24


class WebhookRejected(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


async def process_momo_webhook(provider: str, raw_body: bytes, headers: dict[str, str]) -> dict:
    """Verifies signature + replay protection, then idempotently lands
    the transaction and (if it settles a pending pay link with a matching
    amount) writes `PAYMENT_RECEIVED` allocated oldest-first. Raises
    `WebhookRejected` for every failure category with a generic message --
    see security/webhooks.py and docs/DECISIONS.md for why the same
    generic outcome (and comparable timing) is used whether the business
    wasn't found, credentials weren't connected, the signature didn't
    match, or the timestamp was stale.
    """
    timestamp = headers.get("x-momo-timestamp", "")
    nonce = headers.get("x-momo-nonce", "")
    signature = headers.get("x-momo-signature", "")

    try:
        payload = json.loads(raw_body)
    except (ValueError, TypeError):
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    business_id = payload.get("business_id") or ""

    now = datetime.now(UTC)
    secret: str | None = None
    async with tenant_scoped_session(business_id) as session:
        if business_id:
            cred_result = await session.execute(
                select(MomoProviderCredential).where(
                    MomoProviderCredential.business_id == business_id,
                    MomoProviderCredential.provider == provider,
                    MomoProviderCredential.status == "connected",
                )
            )
            cred = cred_result.scalar_one_or_none()
            if cred is not None:
                secret = decrypt_secret(cred.encrypted_secret)

        signature_ok = verify_signature(secret, timestamp, nonce, raw_body, signature)
        timestamp_ok = timestamp_within_window(timestamp, now_epoch=now.timestamp())

        if not (business_id and signature_ok and timestamp_ok):
            raise WebhookRejected(401, "Webhook signature verification failed.")

        # Replay protection: a nonce this (business_id, provider) has
        # already seen is rejected even though the signature is valid --
        # see models/momo.py::MomoWebhookNonce.
        nonce_stmt = (
            pg_insert(MomoWebhookNonce)
            .values(business_id=business_id, provider=provider, nonce=nonce, received_at=now)
            .on_conflict_do_nothing(index_elements=["business_id", "provider", "nonce"])
            .returning(MomoWebhookNonce.id)
        )
        nonce_result = await session.execute(nonce_stmt)
        if nonce_result.scalar_one_or_none() is None:
            raise WebhookRejected(401, "Webhook signature verification failed.")

        external_id = payload.get("external_id")
        phone = payload.get("phone")
        amount_minor = payload.get("amount_minor")
        if not external_id or not phone or not isinstance(amount_minor, int):
            raise WebhookRejected(422, "Malformed webhook payload.")

        # Idempotent on (business_id, provider, external_id) -- spec
        # G.1/plan §3: an external system controls retries here, not our
        # own client, so this replaces the usual Idempotency-Key header.
        txn_stmt = (
            pg_insert(MomoTransaction)
            .values(
                business_id=business_id,
                provider=provider,
                external_id=external_id,
                phone=phone,
                amount_minor=amount_minor,
                direction=payload.get("direction", "in"),
                occurred_at=now,
                raw_payload=payload,
                status="unmatched",
            )
            .on_conflict_do_nothing(index_elements=["business_id", "provider", "external_id"])
            .returning(MomoTransaction.id)
        )
        txn_result = await session.execute(txn_stmt)
        txn_id = txn_result.scalar_one_or_none()
        if txn_id is None:
            # Already processed by an earlier delivery of this same
            # external_id -- idempotent success, no reprocessing.
            return {"status": "already_processed"}

        # If this settles a pending pay link with a matching amount, close
        # the loop end-to-end (plan §0.5) -- auto-allocated oldest-first,
        # same allocation engine take-payment uses.
        pay_link_result = await session.execute(
            select(PayLink).where(
                PayLink.business_id == business_id,
                PayLink.momo_external_id == external_id,
                PayLink.status == "pending",
            )
        )
        pay_link = pay_link_result.scalar_one_or_none()
        if pay_link is not None and pay_link.amount_minor == amount_minor:
            invoices = await open_invoices_for_customer(session, business_id, pay_link.customer_id)
            allocations, _unallocated = auto_allocate(invoices, amount_minor)

            event = await append_event(
                session,
                EventEnvelopeInput(
                    business_id=business_id,
                    type="PAYMENT_RECEIVED",
                    payload={
                        "customer_id": pay_link.customer_id,
                        "amount_minor": amount_minor,
                        "method": "momo",
                        "money_location": "momo",
                        "reference": f"paylink:{pay_link.id}",
                    },
                    actor_user_id=None,
                    actor_source="system",
                    location_id=pay_link.location_id,
                    occurred_at=now,
                ),
            )
            for sale_id, alloc_amount in allocations:
                session.add(
                    PaymentAllocation(
                        business_id=business_id,
                        payment_event_id=event.id,
                        sale_id=sale_id,
                        amount_minor=alloc_amount,
                    )
                )
            pay_link.status = "paid"
            pay_link.paid_at = now
            pay_link.payment_event_id = event.id

            txn = await session.get(MomoTransaction, txn_id)
            if txn is not None:
                txn.status = "matched"
                txn.matched_to_type = "pay_link"
                txn.matched_to_id = pay_link.id
                txn.matched_event_id = event.id

            return {"status": "settled_pay_link", "payment_event_id": event.id}

        return {"status": "landed_unmatched", "transaction_id": txn_id}


@router.post("/webhook/{provider}", status_code=200)
async def momo_webhook(provider: str, request: Request) -> dict:
    """PUBLIC, no tenant auth -- the second of the two places this phase
    intentionally opens a hole in the normal auth wall (the first is
    `/pay/{token}`). See module docstring."""
    raw_body = await request.body()
    headers = {k.lower(): v for k, v in request.headers.items()}
    try:
        result = await process_momo_webhook(provider, raw_body, headers)
    except WebhookRejected as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    except EnvelopeValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return result


# --- provider connect/disconnect (sandbox) ----------------------------------


@router.post("/connect", response_model=MomoConnectOut, status_code=201)
async def connect_provider(
    body: MomoConnectRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("momo.connect")),
) -> MomoConnectOut:
    raw_body = await request.body()
    fingerprint = fingerprint_request("POST", "/api/v1/momo/connect", ctx.business_id, raw_body)
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint="POST /api/v1/momo/connect",
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
            raise RuntimeError("idempotency row has no response_body despite being complete")
        return MomoConnectOut(**existing.response_body)

    provider = get_mobile_money_provider()
    secret = await provider.connect(business_id=ctx.business_id, merchant_ref=body.merchant_ref)
    now = datetime.now(UTC)

    existing_cred_result = await ctx.session.execute(
        select(MomoProviderCredential).where(
            MomoProviderCredential.business_id == ctx.business_id,
            MomoProviderCredential.provider == provider.provider_key,
        )
    )
    cred = existing_cred_result.scalar_one_or_none()
    if cred is None:
        cred = MomoProviderCredential(
            business_id=ctx.business_id,
            provider=provider.provider_key,
            encrypted_secret=encrypt_secret(secret),
            merchant_ref=body.merchant_ref,
            status="connected",
            connected_at=now,
        )
        ctx.session.add(cred)
    else:
        cred.encrypted_secret = encrypt_secret(secret)
        cred.merchant_ref = body.merchant_ref
        cred.status = "connected"
        cred.connected_at = now
        cred.disconnected_at = None
    await ctx.session.flush()

    out = MomoConnectOut(
        provider=provider.provider_key, status="connected", connected_at=now.isoformat()
    )
    await complete(ctx.session, claimed_id=claimed_id, status_code=201, body=out.model_dump())
    return out


@router.post("/disconnect", response_model=MomoConnectOut)
async def disconnect_provider(
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("momo.connect")),
) -> MomoConnectOut:
    raw_body = await request.body()
    fingerprint = fingerprint_request("POST", "/api/v1/momo/disconnect", ctx.business_id, raw_body)
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint="POST /api/v1/momo/disconnect",
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
            raise RuntimeError("idempotency row has no response_body despite being complete")
        return MomoConnectOut(**existing.response_body)

    provider_key = get_mobile_money_provider().provider_key
    cred_result = await ctx.session.execute(
        select(MomoProviderCredential).where(
            MomoProviderCredential.business_id == ctx.business_id,
            MomoProviderCredential.provider == provider_key,
        )
    )
    cred = cred_result.scalar_one_or_none()
    now = datetime.now(UTC)
    if cred is not None:
        cred.status = "disconnected"
        cred.disconnected_at = now
        await ctx.session.flush()

    out = MomoConnectOut(provider=provider_key, status="disconnected", connected_at=None)
    await complete(ctx.session, claimed_id=claimed_id, status_code=200, body=out.model_dump())
    return out


# --- reconciliation (D.7.3) --------------------------------------------------


@router.get("/transactions", response_model=list[MomoTransactionOut])
async def list_momo_transactions(
    status: str | None = None,
    ctx: RequestContext = Depends(require_capability("momo.reconcile")),
) -> list[MomoTransactionOut]:
    stmt = select(MomoTransaction).where(MomoTransaction.business_id == ctx.business_id)
    if status:
        stmt = stmt.where(MomoTransaction.status == status)
    result = await ctx.session.execute(stmt.order_by(MomoTransaction.occurred_at.desc()))
    return [
        MomoTransactionOut(
            id=t.id,
            provider=t.provider,
            external_id=t.external_id,
            phone=t.phone,
            amount_minor=t.amount_minor,
            direction=t.direction,
            occurred_at=t.occurred_at.isoformat(),
            status=t.status,
            matched_to_type=t.matched_to_type,
            matched_to_id=t.matched_to_id,
        )
        for t in result.scalars()
    ]


@router.get("/transactions/suggestions", response_model=list[MomoMatchSuggestionOut])
async def suggest_matches(
    ctx: RequestContext = Depends(require_capability("momo.reconcile")),
) -> list[MomoMatchSuggestionOut]:
    """D.7.3's auto-match engine: pairs an unmatched incoming transaction
    against a customer by phone, within a time window, with a confidence
    indicator based on whether the amount also matches an open invoice
    exactly. This is a real matching pass over real data -- not a stub --
    but deliberately simple (phone + time window + amount-against-open-
    invoices) rather than a scored/ML approach; spec D.7.3 asks for
    "amount + phone + time window" specifically, which this implements
    directly."""
    txn_result = await ctx.session.execute(
        select(MomoTransaction).where(
            MomoTransaction.business_id == ctx.business_id,
            MomoTransaction.status == "unmatched",
            MomoTransaction.direction == "in",
        )
    )
    transactions = list(txn_result.scalars())
    if not transactions:
        return []

    customers_result = await ctx.session.execute(
        select(Customer).where(Customer.business_id == ctx.business_id)
    )
    customers = list(customers_result.scalars())

    suggestions: list[MomoMatchSuggestionOut] = []
    for txn in transactions:
        for customer in customers:
            if not customer.phone or customer.phone != txn.phone:
                continue
            invoices = await open_invoices_for_customer(ctx.session, ctx.business_id, customer.id)
            exact_amount_invoice = next(
                (inv for inv in invoices if inv.remaining_minor == txn.amount_minor), None
            )
            if exact_amount_invoice is not None:
                # D.7.3: "pairing on amount + phone + time window" -- an
                # exact amount+phone match still only earns "high"
                # confidence if the invoice was also raised within the
                # window; otherwise it's a coincidental amount match on an
                # old invoice, which is worth surfacing but not as
                # confidently.
                hours_apart = (
                    abs((txn.occurred_at - exact_amount_invoice.occurred_at).total_seconds()) / 3600
                )
                within_window = hours_apart <= MATCH_TIME_WINDOW_HOURS
                suggestions.append(
                    MomoMatchSuggestionOut(
                        transaction_id=txn.id,
                        customer_id=customer.id,
                        customer_name=customer.name,
                        sale_id=exact_amount_invoice.sale_id,
                        confidence="high" if within_window else "medium",
                        reason=(
                            "Phone, amount, and time window all match an open invoice."
                            if within_window
                            else "Phone and amount match an open invoice, but outside the "
                            f"{MATCH_TIME_WINDOW_HOURS}h matching window."
                        ),
                    )
                )
            elif invoices:
                suggestions.append(
                    MomoMatchSuggestionOut(
                        transaction_id=txn.id,
                        customer_id=customer.id,
                        customer_name=customer.name,
                        sale_id=None,
                        confidence="medium",
                        reason="Phone matches a customer with open invoices, amount differs.",
                    )
                )
            else:
                suggestions.append(
                    MomoMatchSuggestionOut(
                        transaction_id=txn.id,
                        customer_id=customer.id,
                        customer_name=customer.name,
                        sale_id=None,
                        confidence="low",
                        reason="Phone matches a customer with no open invoices.",
                    )
                )
    return suggestions


@router.post("/transactions/{transaction_id}/match", response_model=MomoMatchOut, status_code=201)
async def match_transaction(
    transaction_id: str,
    body: MomoMatchRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("momo.reconcile")),
) -> MomoMatchOut:
    raw_body = await request.body()
    fingerprint = fingerprint_request(
        "POST", f"/api/v1/momo/transactions/{transaction_id}/match", ctx.business_id, raw_body
    )
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint=f"POST /api/v1/momo/transactions/{transaction_id}/match",
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
            raise RuntimeError("idempotency row has no response_body despite being complete")
        return MomoMatchOut(**existing.response_body)

    txn = await ctx.session.get(MomoTransaction, transaction_id)
    if txn is None:
        raise HTTPException(status_code=404, detail="Not found.")
    if txn.status != "unmatched":
        raise HTTPException(status_code=409, detail=f"This transaction is already {txn.status}.")

    payment_event_id: str | None = None

    if body.matched_to_type == "not_ours":
        txn.status = "ignored"
    elif body.matched_to_type in ("invoice", "debt_payment"):
        if not body.customer_id:
            raise HTTPException(
                status_code=422, detail="customer_id is required for this match type."
            )
        if not body.location_id:
            raise HTTPException(
                status_code=422, detail="location_id is required for this match type."
            )
        invoices = await open_invoices_for_customer(ctx.session, ctx.business_id, body.customer_id)
        if body.matched_to_type == "invoice" and body.sale_id:
            if body.sale_id not in {inv.sale_id for inv in invoices}:
                raise HTTPException(
                    status_code=422,
                    detail="sale_id is not an open invoice for this customer.",
                )
            allocations = [(body.sale_id, txn.amount_minor)]
        else:
            allocations, _unallocated = auto_allocate(invoices, txn.amount_minor)

        try:
            event = await append_event(
                ctx.session,
                EventEnvelopeInput(
                    business_id=ctx.business_id,
                    type="PAYMENT_RECEIVED",
                    payload={
                        "customer_id": body.customer_id,
                        "amount_minor": txn.amount_minor,
                        "method": "momo",
                        "money_location": "momo",
                        "reference": f"momo:{txn.external_id}",
                    },
                    actor_user_id=ctx.user_id,
                    actor_source="api",
                    location_id=body.location_id,
                ),
            )
        except EnvelopeValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        for sale_id, alloc_amount in allocations:
            ctx.session.add(
                PaymentAllocation(
                    business_id=ctx.business_id,
                    payment_event_id=event.id,
                    sale_id=sale_id,
                    amount_minor=alloc_amount,
                )
            )
        payment_event_id = event.id
        txn.status = "matched"
        txn.matched_to_type = body.matched_to_type
        txn.matched_to_id = body.customer_id
        txn.matched_event_id = event.id
    elif body.matched_to_type == "other_income":
        if not body.location_id:
            raise HTTPException(
                status_code=422, detail="location_id is required for this match type."
            )
        try:
            event = await append_event(
                ctx.session,
                EventEnvelopeInput(
                    business_id=ctx.business_id,
                    type="PAYMENT_RECEIVED",
                    payload={
                        "amount_minor": txn.amount_minor,
                        "method": "momo",
                        "money_location": "momo",
                        "reference": f"momo:{txn.external_id}",
                    },
                    actor_user_id=ctx.user_id,
                    actor_source="api",
                    location_id=body.location_id,
                ),
            )
        except EnvelopeValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        payment_event_id = event.id
        txn.status = "matched"
        txn.matched_to_type = "other_income"
        txn.matched_event_id = event.id
    else:
        raise HTTPException(
            status_code=422, detail=f"Unknown matched_to_type {body.matched_to_type!r}."
        )

    await ctx.session.flush()
    out = MomoMatchOut(transaction_id=txn.id, status=txn.status, payment_event_id=payment_event_id)
    await complete(ctx.session, claimed_id=claimed_id, status_code=201, body=out.model_dump())
    return out


@router.post("/transactions/import", response_model=MomoImportResultOut, status_code=201)
async def import_momo_csv(
    file: UploadFile,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("momo.reconcile")),
) -> MomoImportResultOut:
    """D.7.3: "a manual CSV import of 'transactions from the provider'" --
    lands rows through the identical unmatched-staging path a webhook
    would, idempotent on (business_id, provider, external_id) the same
    way, so the reconciliation engine downstream is genuinely
    provider-agnostic (plan §0.3).

    The idempotency fingerprint is computed from the FILE CONTENT, not
    `await request.body()` -- unlike a JSON body, a `multipart/form-data`
    upload is parsed by Starlette into `UploadFile` via a separate stream-
    consuming code path than the one `request.body()` reads from; calling
    `request.body()` when a route also takes an `UploadFile` parameter
    raises `RuntimeError: Stream consumed` because there is nothing left
    to read a second time (hit this for real while writing this endpoint
    -- see docs/DECISIONS.md).
    """
    content = await file.read()
    fingerprint = fingerprint_request(
        "POST", "/api/v1/momo/transactions/import", ctx.business_id, content
    )
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint="POST /api/v1/momo/transactions/import",
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
            raise RuntimeError("idempotency row has no response_body despite being complete")
        return MomoImportResultOut(**existing.response_body)

    reader = csv.DictReader(io.StringIO(content.decode("utf-8-sig")))
    imported = 0
    skipped = 0
    now = datetime.now(UTC)
    for row in reader:
        external_id = row.get("external_id") or row.get("transaction_id")
        phone = row.get("phone")
        amount_raw = row.get("amount_minor") or row.get("amount")
        if not external_id or not phone or not amount_raw:
            continue
        stmt = (
            pg_insert(MomoTransaction)
            .values(
                business_id=ctx.business_id,
                provider="manual_import",
                external_id=external_id,
                phone=phone,
                amount_minor=int(amount_raw),
                direction=row.get("direction", "in"),
                occurred_at=now,
                raw_payload=dict(row),
                status="unmatched",
            )
            .on_conflict_do_nothing(index_elements=["business_id", "provider", "external_id"])
            .returning(MomoTransaction.id)
        )
        result = await ctx.session.execute(stmt)
        if result.scalar_one_or_none() is None:
            skipped += 1
        else:
            imported += 1
    await ctx.session.flush()

    out = MomoImportResultOut(imported=imported, skipped_duplicates=skipped)
    await complete(ctx.session, claimed_id=claimed_id, status_code=201, body=out.model_dump())
    return out
