"""Customers (spec D.4 quick-add, D.6 minimal backing per plan §0.2).

Creation only requires `sale.create` (a Cashier can quick-add a walk-in
customer inline at the Counter, spec D.4: "requires only name + phone") --
editing a profile or changing a credit limit requires `customer.manage`
(Owner/Manager only by default, capabilities.py). A quick-add always starts
at credit_limit_minor=0 unless the caller also holds `customer.manage`
(silently ignoring a cashier-supplied nonzero limit would be worse than
rejecting it, so the 0-default is enforced by simply not trusting a
`credit_limit_minor` from a caller without that capability -- see
`create_customer`).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import or_, select

from operatoros_api.api.deps import (
    RequestContext,
    get_current_context,
    idempotency_key_header,
    require_capability,
)
from operatoros_api.idempotency_service import (
    claim_or_replay,
    complete,
    fingerprint_request,
    get_existing,
)
from operatoros_api.ledger import EnvelopeValidationError, EventEnvelopeInput, append_event
from operatoros_api.models.customers import Customer, CustomerBalance
from operatoros_api.schemas.customers import (
    CreditLimitChangeRequest,
    CustomerCreate,
    CustomerOut,
    CustomerUpdate,
)
from operatoros_api.security.identifiers import hash_identifier

router = APIRouter(prefix="/api/v1/customers", tags=["customers"])


async def _to_customer_out(ctx: RequestContext, customer: Customer) -> CustomerOut:
    result = await ctx.session.execute(
        select(CustomerBalance).where(CustomerBalance.customer_id == customer.id)
    )
    balance = result.scalar_one_or_none()
    credit_limit = balance.credit_limit_minor if balance else 0
    bal_minor = balance.balance_minor if balance else 0
    limit_used = int((bal_minor / credit_limit) * 100) if credit_limit > 0 else 0
    return CustomerOut(
        id=customer.id,
        name=customer.name,
        phone=customer.phone,
        terms_days=customer.terms_days,
        language=customer.language,
        status=customer.status,
        credit_limit_minor=credit_limit,
        balance_minor=bal_minor,
        limit_used_percent=limit_used,
        oldest_unpaid_at=(
            balance.oldest_unpaid_at.isoformat() if balance and balance.oldest_unpaid_at else None
        ),
    )


@router.get("", response_model=list[CustomerOut])
async def list_customers(
    search: str | None = Query(default=None),
    ctx: RequestContext = Depends(get_current_context),
) -> list[CustomerOut]:
    stmt = select(Customer)
    if search:
        like = f"%{search}%"
        stmt = stmt.where(or_(Customer.name.ilike(like), Customer.phone.ilike(like)))
    result = await ctx.session.execute(stmt.order_by(Customer.name).limit(500))
    return [await _to_customer_out(ctx, c) for c in result.scalars()]


@router.get("/{customer_id}", response_model=CustomerOut)
async def get_customer(
    customer_id: str, ctx: RequestContext = Depends(get_current_context)
) -> CustomerOut:
    customer = await ctx.session.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(status_code=404, detail="Not found.")
    return await _to_customer_out(ctx, customer)


@router.post("", response_model=CustomerOut, status_code=201)
async def create_customer(
    body: CustomerCreate,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("sale.create")),
) -> CustomerOut:
    raw_body = await request.body()
    fingerprint = fingerprint_request("POST", "/api/v1/customers", ctx.business_id, raw_body)
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint="POST /api/v1/customers",
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
        return CustomerOut(**existing.response_body)

    customer = Customer(
        business_id=ctx.business_id,
        name=body.name,
        phone=body.phone,
        phone_hash=hash_identifier(body.phone) if body.phone else None,
        terms_days=body.terms_days,
        language=body.language,
    )
    ctx.session.add(customer)
    await ctx.session.flush()

    try:
        await append_event(
            ctx.session,
            EventEnvelopeInput(
                business_id=ctx.business_id,
                type="CUSTOMER_CREATED",
                payload={
                    "customer_id": customer.id,
                    "name": customer.name,
                    "phone_hash": customer.phone_hash,
                },
                actor_user_id=ctx.user_id,
                actor_source="api",
            ),
        )
        requested_limit = (
            body.credit_limit_minor if ctx.capabilities.has("customer.manage", None) else 0
        )
        if requested_limit > 0:
            await append_event(
                ctx.session,
                EventEnvelopeInput(
                    business_id=ctx.business_id,
                    type="CREDIT_LIMIT_CHANGED",
                    payload={
                        "customer_id": customer.id,
                        "old_limit_minor": 0,
                        "new_limit_minor": requested_limit,
                    },
                    actor_user_id=ctx.user_id,
                    actor_source="api",
                ),
            )
    except EnvelopeValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    out = await _to_customer_out(ctx, customer)
    await complete(ctx.session, claimed_id=claimed_id, status_code=201, body=out.model_dump())
    return out


@router.patch("/{customer_id}", response_model=CustomerOut)
async def update_customer(
    customer_id: str,
    body: CustomerUpdate,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("customer.manage")),
) -> CustomerOut:
    raw_body = await request.body()
    fingerprint = fingerprint_request(
        "PATCH", f"/api/v1/customers/{customer_id}", ctx.business_id, raw_body
    )
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint=f"PATCH /api/v1/customers/{customer_id}",
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
        return CustomerOut(**existing.response_body)

    customer = await ctx.session.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(status_code=404, detail="Not found.")

    if body.name is not None:
        customer.name = body.name
    if body.phone is not None:
        customer.phone = body.phone
        customer.phone_hash = hash_identifier(body.phone)
    if body.terms_days is not None:
        customer.terms_days = body.terms_days
    if body.language is not None:
        customer.language = body.language
    if body.status is not None:
        customer.status = body.status
    await ctx.session.flush()

    out = await _to_customer_out(ctx, customer)
    await complete(ctx.session, claimed_id=claimed_id, status_code=200, body=out.model_dump())
    return out


@router.post("/{customer_id}/credit-limit", response_model=CustomerOut)
async def change_credit_limit(
    customer_id: str,
    body: CreditLimitChangeRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("customer.manage")),
) -> CustomerOut:
    raw_body = await request.body()
    fingerprint = fingerprint_request(
        "POST", f"/api/v1/customers/{customer_id}/credit-limit", ctx.business_id, raw_body
    )
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint=f"POST /api/v1/customers/{customer_id}/credit-limit",
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
        return CustomerOut(**existing.response_body)

    customer = await ctx.session.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(status_code=404, detail="Not found.")

    balance_result = await ctx.session.execute(
        select(CustomerBalance).where(CustomerBalance.customer_id == customer_id)
    )
    balance = balance_result.scalar_one_or_none()
    old_limit = balance.credit_limit_minor if balance else 0

    try:
        await append_event(
            ctx.session,
            EventEnvelopeInput(
                business_id=ctx.business_id,
                type="CREDIT_LIMIT_CHANGED",
                payload={
                    "customer_id": customer_id,
                    "old_limit_minor": old_limit,
                    "new_limit_minor": body.new_limit_minor,
                    "reason": body.reason,
                },
                actor_user_id=ctx.user_id,
                actor_source="api",
            ),
        )
    except EnvelopeValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    out = await _to_customer_out(ctx, customer)
    await complete(ctx.session, claimed_id=claimed_id, status_code=200, body=out.model_dump())
    return out
