"""Stock transfers between locations (spec D.5.5, plan §3).

Stock leaves the origin immediately into an `in_transit` state
(`STOCK_TRANSFERRED_OUT` appended at creation) and only arrives at the
destination when it confirms receipt (`STOCK_TRANSFERRED_IN`, appended at
receive time, with whatever quantity was ACTUALLY received). Receiving a
different quantity than was sent is a first-class outcome, not an error --
it marks that line (and the transfer as a whole) with a discrepancy flag
for follow-up rather than silently reconciling the numbers. This is what
prevents the "stock exists in two places at once" fiction the spec calls
out explicitly.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select

from operatoros_api.api.deps import RequestContext, idempotency_key_header, require_capability
from operatoros_api.idempotency_service import (
    claim_or_replay,
    complete,
    fingerprint_request,
    get_existing,
)
from operatoros_api.ledger import EnvelopeValidationError, EventEnvelopeInput, append_event
from operatoros_api.models.base import uuid7_str
from operatoros_api.models.catalog import ProductLocation
from operatoros_api.models.stock import StockTransfer, StockTransferLine
from operatoros_api.schemas.transfers import (
    TransferCreateRequest,
    TransferLineOut,
    TransferOut,
    TransferReceiveRequest,
)

router = APIRouter(prefix="/api/v1/stock", tags=["stock"])


async def _transfer_out(ctx: RequestContext, transfer: StockTransfer) -> TransferOut:
    lines_result = await ctx.session.execute(
        select(StockTransferLine).where(StockTransferLine.transfer_id == transfer.id)
    )
    lines = list(lines_result.scalars())
    return TransferOut(
        id=transfer.id,
        from_location_id=transfer.from_location_id,
        to_location_id=transfer.to_location_id,
        status=transfer.status,
        sent_at=transfer.sent_at.isoformat(),
        received_at=transfer.received_at.isoformat() if transfer.received_at else None,
        lines=[
            TransferLineOut(
                product_id=line.product_id,
                quantity_sent=str(line.quantity_sent),
                quantity_received=(
                    str(line.quantity_received) if line.quantity_received is not None else None
                ),
                discrepancy=line.discrepancy,
            )
            for line in lines
        ],
    )


@router.post("/transfers", response_model=TransferOut, status_code=201)
async def create_transfer(
    body: TransferCreateRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("stock.transfer")),
) -> TransferOut:
    raw_body = await request.body()
    fingerprint = fingerprint_request("POST", "/api/v1/stock/transfers", ctx.business_id, raw_body)
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint="POST /api/v1/stock/transfers",
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
        return TransferOut(**existing.response_body)

    if body.from_location_id == body.to_location_id:
        raise HTTPException(status_code=422, detail="A transfer needs two different locations.")
    if not body.lines:
        raise HTTPException(status_code=422, detail="A transfer needs at least one line.")

    for line in body.lines:
        quantity = Decimal(line.quantity)
        result = await ctx.session.execute(
            select(ProductLocation).where(
                ProductLocation.location_id == body.from_location_id,
                ProductLocation.product_id == line.product_id,
            )
        )
        row = result.scalar_one_or_none()
        available = (row.on_hand - row.reserved) if row else Decimal("0")
        if quantity > available:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Only {available} of product {line.product_id} is available to transfer "
                    f"from this location, but {quantity} was requested."
                ),
            )

    transfer_id = uuid7_str()
    now = datetime.now(UTC)
    transfer = StockTransfer(
        id=transfer_id,
        business_id=ctx.business_id,
        from_location_id=body.from_location_id,
        to_location_id=body.to_location_id,
        status="in_transit",
        created_by_user_id=ctx.user_id,
        sent_at=now,
    )
    ctx.session.add(transfer)
    await ctx.session.flush()

    try:
        for line in body.lines:
            quantity = Decimal(line.quantity)
            ctx.session.add(
                StockTransferLine(
                    business_id=ctx.business_id,
                    transfer_id=transfer.id,
                    product_id=line.product_id,
                    quantity_sent=quantity,
                )
            )
            await append_event(
                ctx.session,
                EventEnvelopeInput(
                    business_id=ctx.business_id,
                    type="STOCK_TRANSFERRED_OUT",
                    payload={
                        "product_id": line.product_id,
                        "from_location_id": body.from_location_id,
                        "to_location_id": body.to_location_id,
                        "quantity": str(quantity),
                        "transfer_id": transfer.id,
                    },
                    actor_user_id=ctx.user_id,
                    actor_source="api",
                    location_id=body.from_location_id,
                ),
            )
    except EnvelopeValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    transfer.send_source_event_id = "recorded"
    await ctx.session.flush()

    out = await _transfer_out(ctx, transfer)
    await complete(ctx.session, claimed_id=claimed_id, status_code=201, body=out.model_dump())
    return out


@router.get("/transfers/{transfer_id}", response_model=TransferOut)
async def get_transfer(
    transfer_id: str, ctx: RequestContext = Depends(require_capability("stock.transfer"))
) -> TransferOut:
    transfer = await ctx.session.get(StockTransfer, transfer_id)
    if transfer is None:
        raise HTTPException(status_code=404, detail="Not found.")
    return await _transfer_out(ctx, transfer)


@router.post("/transfers/{transfer_id}/receive", response_model=TransferOut)
async def receive_transfer(
    transfer_id: str,
    body: TransferReceiveRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("stock.transfer")),
) -> TransferOut:
    raw_body = await request.body()
    fingerprint = fingerprint_request(
        "POST", f"/api/v1/stock/transfers/{transfer_id}/receive", ctx.business_id, raw_body
    )
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint=f"POST /api/v1/stock/transfers/{transfer_id}/receive",
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
        return TransferOut(**existing.response_body)

    transfer = await ctx.session.get(StockTransfer, transfer_id)
    if transfer is None:
        raise HTTPException(status_code=404, detail="Not found.")
    if transfer.status != "in_transit":
        raise HTTPException(status_code=409, detail=f"This transfer is already {transfer.status}.")

    lines_result = await ctx.session.execute(
        select(StockTransferLine).where(StockTransferLine.transfer_id == transfer_id)
    )
    lines_by_product = {line.product_id: line for line in lines_result.scalars()}
    received_products = {line.product_id for line in body.lines}
    if received_products != set(lines_by_product):
        raise HTTPException(
            status_code=422,
            detail="Every line on the transfer must be received (quantity 0 if none arrived).",
        )

    any_discrepancy = False
    try:
        for received_line in body.lines:
            line = lines_by_product[received_line.product_id]
            quantity_received = Decimal(received_line.quantity_received)
            line.quantity_received = quantity_received
            line.discrepancy = quantity_received != line.quantity_sent
            any_discrepancy = any_discrepancy or line.discrepancy

            await append_event(
                ctx.session,
                EventEnvelopeInput(
                    business_id=ctx.business_id,
                    type="STOCK_TRANSFERRED_IN",
                    payload={
                        "product_id": line.product_id,
                        "from_location_id": transfer.from_location_id,
                        "to_location_id": transfer.to_location_id,
                        "quantity": str(quantity_received),
                        "transfer_id": transfer.id,
                        "discrepancy": line.discrepancy,
                    },
                    actor_user_id=ctx.user_id,
                    actor_source="api",
                    location_id=transfer.to_location_id,
                ),
            )
            line.receive_source_event_id = "recorded"
    except EnvelopeValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    transfer.status = "discrepancy" if any_discrepancy else "received"
    transfer.received_by_user_id = ctx.user_id
    transfer.received_at = datetime.now(UTC)
    await ctx.session.flush()

    out = await _transfer_out(ctx, transfer)
    await complete(ctx.session, claimed_id=claimed_id, status_code=200, body=out.model_dump())
    return out
