"""Stock: the stock card, the movements ledger, and manual receive/adjust
(spec D.5.2 "Stock" tab, D.5.3, plan §3).

Stocktake (D.5.4) and transfers (D.5.5) live in `stock_stocktake.py` and
`stock_transfers.py`, both mounted under this same router prefix, to keep
this file to the always-on, simpler stock-card/movements/receive/adjust
surface.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select

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
from operatoros_api.models.catalog import Product, ProductLocation
from operatoros_api.models.stock import StockMovement
from operatoros_api.schemas.stock import (
    ProductLocationOut,
    StockAdjustRequest,
    StockIssueRequest,
    StockMovementOut,
    StockReceiveRequest,
)

router = APIRouter(prefix="/api/v1/stock", tags=["stock"])


def _movement_out(row: StockMovement) -> StockMovementOut:
    return StockMovementOut(
        id=row.id,
        location_id=row.location_id,
        product_id=row.product_id,
        movement_type=row.movement_type,
        quantity_delta=str(row.quantity_delta),
        running_balance=str(row.running_balance),
        unit_cost_minor=row.unit_cost_minor,
        reference_type=row.reference_type,
        reference_id=row.reference_id,
        actor_user_id=row.actor_user_id,
        occurred_at=row.occurred_at.isoformat(),
    )


@router.get("/movements", response_model=list[StockMovementOut])
async def list_stock_movements(
    product_id: str | None = Query(default=None),
    location_id: str | None = Query(default=None),
    movement_type: str | None = Query(default=None),
    ctx: RequestContext = Depends(get_current_context),
) -> list[StockMovementOut]:
    stmt = select(StockMovement)
    if product_id:
        stmt = stmt.where(StockMovement.product_id == product_id)
    if location_id:
        stmt = stmt.where(StockMovement.location_id == location_id)
    if movement_type:
        stmt = stmt.where(StockMovement.movement_type == movement_type)
    result = await ctx.session.execute(stmt.order_by(StockMovement.occurred_at.desc()).limit(500))
    return [_movement_out(row) for row in result.scalars()]


@router.get("/card/{product_id}", response_model=list[StockMovementOut])
async def get_stock_card(
    product_id: str,
    location_id: str | None = Query(default=None),
    ctx: RequestContext = Depends(get_current_context),
) -> list[StockMovementOut]:
    stmt = select(StockMovement).where(StockMovement.product_id == product_id)
    if location_id:
        stmt = stmt.where(StockMovement.location_id == location_id)
    result = await ctx.session.execute(stmt.order_by(StockMovement.occurred_at.desc()).limit(200))
    return [_movement_out(row) for row in result.scalars()]


@router.get("/locations", response_model=list[ProductLocationOut])
async def list_product_locations(
    location_id: str | None = Query(default=None),
    low_stock: bool = Query(default=False),
    negative_stock: bool = Query(default=False),
    ctx: RequestContext = Depends(get_current_context),
) -> list[ProductLocationOut]:
    stmt = select(ProductLocation)
    if location_id:
        stmt = stmt.where(ProductLocation.location_id == location_id)
    if negative_stock:
        stmt = stmt.where(ProductLocation.on_hand < 0)
    result = await ctx.session.execute(stmt.limit(1000))
    rows = list(result.scalars())
    if low_stock:
        out = []
        for row in rows:
            product = await ctx.session.get(Product, row.product_id)
            if product is not None and row.on_hand <= product.reorder_point:
                out.append(row)
        rows = out
    return [
        ProductLocationOut(
            product_id=row.product_id,
            location_id=row.location_id,
            on_hand=str(row.on_hand),
            reserved=str(row.reserved),
            available=str(row.on_hand - row.reserved),
            avg_cost_minor=row.avg_cost_minor,
        )
        for row in rows
    ]


@router.post("/receive", response_model=ProductLocationOut, status_code=201)
async def receive_stock(
    body: StockReceiveRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("stock.adjust")),
) -> ProductLocationOut:
    raw_body = await request.body()
    fingerprint = fingerprint_request("POST", "/api/v1/stock/receive", ctx.business_id, raw_body)
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint="POST /api/v1/stock/receive",
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
        return ProductLocationOut(**existing.response_body)

    try:
        await append_event(
            ctx.session,
            EventEnvelopeInput(
                business_id=ctx.business_id,
                type="STOCK_RECEIVED",
                payload={
                    "product_id": body.product_id,
                    "location_id": body.location_id,
                    "quantity": body.quantity,
                    "unit_cost_minor": body.unit_cost_minor,
                    "reference": body.reference,
                },
                actor_user_id=ctx.user_id,
                actor_source="api",
                location_id=body.location_id,
            ),
        )
    except EnvelopeValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    result = await ctx.session.execute(
        select(ProductLocation).where(
            ProductLocation.location_id == body.location_id,
            ProductLocation.product_id == body.product_id,
        )
    )
    row = result.scalar_one()
    out = ProductLocationOut(
        product_id=row.product_id,
        location_id=row.location_id,
        on_hand=str(row.on_hand),
        reserved=str(row.reserved),
        available=str(row.on_hand - row.reserved),
        avg_cost_minor=row.avg_cost_minor,
    )
    await complete(ctx.session, claimed_id=claimed_id, status_code=201, body=out.model_dump())
    return out


@router.post("/issue", response_model=ProductLocationOut, status_code=201)
async def issue_stock(
    body: StockIssueRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("stock.adjust")),
) -> ProductLocationOut:
    raw_body = await request.body()
    fingerprint = fingerprint_request("POST", "/api/v1/stock/issue", ctx.business_id, raw_body)
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint="POST /api/v1/stock/issue",
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
        return ProductLocationOut(**existing.response_body)

    try:
        await append_event(
            ctx.session,
            EventEnvelopeInput(
                business_id=ctx.business_id,
                type="STOCK_ISSUED",
                payload={
                    "product_id": body.product_id,
                    "location_id": body.location_id,
                    "quantity": body.quantity,
                    "reference": body.reference,
                },
                actor_user_id=ctx.user_id,
                actor_source="api",
                location_id=body.location_id,
            ),
        )
    except EnvelopeValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    result = await ctx.session.execute(
        select(ProductLocation).where(
            ProductLocation.location_id == body.location_id,
            ProductLocation.product_id == body.product_id,
        )
    )
    row = result.scalar_one()
    out = ProductLocationOut(
        product_id=row.product_id,
        location_id=row.location_id,
        on_hand=str(row.on_hand),
        reserved=str(row.reserved),
        available=str(row.on_hand - row.reserved),
        avg_cost_minor=row.avg_cost_minor,
    )
    await complete(ctx.session, claimed_id=claimed_id, status_code=201, body=out.model_dump())
    return out


@router.post("/adjust", response_model=ProductLocationOut, status_code=201)
async def adjust_stock(
    body: StockAdjustRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("stock.adjust")),
) -> ProductLocationOut:
    raw_body = await request.body()
    fingerprint = fingerprint_request("POST", "/api/v1/stock/adjust", ctx.business_id, raw_body)
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint="POST /api/v1/stock/adjust",
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
        return ProductLocationOut(**existing.response_body)

    try:
        await append_event(
            ctx.session,
            EventEnvelopeInput(
                business_id=ctx.business_id,
                type="STOCK_ADJUSTED",
                payload={
                    "product_id": body.product_id,
                    "location_id": body.location_id,
                    "quantity_delta": body.quantity_delta,
                    "reason": body.reason,
                },
                actor_user_id=ctx.user_id,
                actor_source="api",
                location_id=body.location_id,
            ),
        )
    except EnvelopeValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    result = await ctx.session.execute(
        select(ProductLocation).where(
            ProductLocation.location_id == body.location_id,
            ProductLocation.product_id == body.product_id,
        )
    )
    row = result.scalar_one()
    out = ProductLocationOut(
        product_id=row.product_id,
        location_id=row.location_id,
        on_hand=str(row.on_hand),
        reserved=str(row.reserved),
        available=str(row.on_hand - row.reserved),
        avg_cost_minor=row.avg_cost_minor,
    )
    await complete(ctx.session, claimed_id=claimed_id, status_code=201, body=out.model_dump())
    return out
