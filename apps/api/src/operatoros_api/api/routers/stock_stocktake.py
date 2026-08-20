"""Stock-take lifecycle (spec D.5.4, plan §3): start -> count -> review
(variances only) -> post.

Mounted under the same `/api/v1/stock` prefix as `stock.py` (kept in its
own file since the workflow is substantial on its own).

Nothing is silently overwritten (spec D.5.4): posting a stock-take never
writes `on_hand` directly. Instead it appends one `STOCK_ADJUSTED` event per
line with a non-zero variance -- which is what actually moves stock, through
the same `product_stock` projection every other stock-affecting action uses
-- plus one summary `STOCKTAKE_POSTED` event for the audit trail. See
projections/product_stock.py's module docstring for why `STOCKTAKE_POSTED`
itself has no projection handler.

**Scope, disclosed simplification:** `scope` supports `all` (every active
product at the location), `category` (one category), and `list` (explicit
product ids). Spec D.5.4 also lists "items not counted in 90 days" as a
scope option -- not implemented this phase (it needs a
last-movement-per-product query across the full `stock_movements` history,
judged lower priority than the rest of Phase 1's scope within the time
available); an unrecognised scope value falls back to `all` rather than
erroring, and this is flagged here and in the final report rather than
silently guessed.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal

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
from operatoros_api.models.catalog import Product, ProductLocation
from operatoros_api.models.stock import Stocktake, StocktakeLine
from operatoros_api.schemas.stocktake import (
    StocktakeCountRequest,
    StocktakeLineOut,
    StocktakeLineReasonRequest,
    StocktakeOut,
    StocktakeStartRequest,
)

router = APIRouter(prefix="/api/v1/stock", tags=["stock"])

# Spec D.5.4: "Each variance row requires a reason before posting if it
# exceeds a threshold." A fixed value (RWF 10,000, i.e. 1,000,000 minor
# units) since there's no per-business settings screen for this yet --
# same kind of disclosed simplification as sales.py's fixed VAT rate.
VARIANCE_REASON_REQUIRED_THRESHOLD_MINOR = 1_000_000


def _round_minor(value: Decimal) -> int:
    return int(value.to_integral_value(rounding=ROUND_HALF_UP))


async def is_frozen_for_stocktake(session, location_id: str, product_id: str) -> bool:
    """Whether `product_id` at `location_id` is currently frozen by an
    in-progress, freezing stock-take (spec D.5.4: "freeze the counted items
    (blocks sales of those items during the count)"). Imported by
    api/routers/sales.py's stock check -- see this module's comment in
    `start_stocktake` for why this is a live query rather than a stored
    `ProductLocation.frozen` flag."""
    result = await session.execute(
        select(StocktakeLine.id)
        .join(Stocktake, Stocktake.id == StocktakeLine.stocktake_id)
        .where(
            Stocktake.location_id == location_id,
            Stocktake.freeze_during_count.is_(True),
            Stocktake.status.in_(["counting", "reviewing"]),
            StocktakeLine.product_id == product_id,
        )
        .limit(1)
    )
    return result.first() is not None


async def _line_out(line: StocktakeLine) -> StocktakeLineOut:
    return StocktakeLineOut(
        id=line.id,
        product_id=line.product_id,
        expected_quantity=str(line.expected_quantity),
        counted_quantity=str(line.counted_quantity) if line.counted_quantity is not None else None,
        counted_by_user_id=line.counted_by_user_id,
        counted_at=line.counted_at.isoformat() if line.counted_at else None,
        variance_qty=str(line.variance_qty) if line.variance_qty is not None else None,
        variance_value_minor=line.variance_value_minor,
        reason=line.reason,
    )


async def _stocktake_out(ctx: RequestContext, stocktake: Stocktake) -> StocktakeOut:
    lines_result = await ctx.session.execute(
        select(StocktakeLine).where(StocktakeLine.stocktake_id == stocktake.id)
    )
    lines = list(lines_result.scalars())
    counted = sum(1 for line in lines if line.counted_quantity is not None)
    return StocktakeOut(
        id=stocktake.id,
        location_id=stocktake.location_id,
        scope=stocktake.scope,
        status=stocktake.status,
        freeze_during_count=stocktake.freeze_during_count,
        started_at=stocktake.started_at.isoformat(),
        posted_at=stocktake.posted_at.isoformat() if stocktake.posted_at else None,
        variance_value_minor=stocktake.variance_value_minor,
        line_count=stocktake.line_count,
        progress_counted=counted,
        progress_total=len(lines),
        lines=[await _line_out(line) for line in lines],
    )


@router.post("/stocktakes", response_model=StocktakeOut, status_code=201)
async def start_stocktake(
    body: StocktakeStartRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("stock.adjust")),
) -> StocktakeOut:
    raw_body = await request.body()
    fingerprint = fingerprint_request("POST", "/api/v1/stock/stocktakes", ctx.business_id, raw_body)
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint="POST /api/v1/stock/stocktakes",
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
        return StocktakeOut(**existing.response_body)

    stmt = select(Product).where(Product.business_id == ctx.business_id, Product.status == "active")
    if body.scope == "category" and body.category_id:
        stmt = stmt.where(Product.category_id == body.category_id)
    elif body.scope == "list" and body.product_ids:
        stmt = stmt.where(Product.id.in_(body.product_ids))
    # "all" and any unrecognised scope value fall back to every active
    # product -- see module docstring.
    products_result = await ctx.session.execute(stmt)
    products = list(products_result.scalars())
    if not products:
        raise HTTPException(status_code=422, detail="No products match this stock-take's scope.")

    now = datetime.now(UTC)
    stocktake = Stocktake(
        business_id=ctx.business_id,
        location_id=body.location_id,
        scope=body.scope,
        scope_filter={"category_id": body.category_id, "product_ids": body.product_ids},
        freeze_during_count=body.freeze_during_count,
        status="counting",
        started_by_user_id=ctx.user_id,
        started_at=now,
    )
    ctx.session.add(stocktake)
    await ctx.session.flush()

    for product in products:
        loc_result = await ctx.session.execute(
            select(ProductLocation).where(
                ProductLocation.location_id == body.location_id,
                ProductLocation.product_id == product.id,
            )
        )
        loc_row = loc_result.scalar_one_or_none()
        expected = loc_row.on_hand if loc_row else Decimal("0")
        ctx.session.add(
            StocktakeLine(
                business_id=ctx.business_id,
                stocktake_id=stocktake.id,
                product_id=product.id,
                expected_quantity=expected,
            )
        )
        # Freeze state deliberately does NOT live on ProductLocation.frozen
        # (that column exists in the schema but is unused -- see
        # is_frozen_for_stocktake() below and docs/DECISIONS.md): writing it
        # here would be a direct write to a `reject_direct_projection_write()`
        # -protected projection table from outside the projection framework,
        # which the trigger correctly rejects (caught by
        # tests/test_stocktake_and_transfers.py during development). "Is this
        # product frozen" is answered by querying for an open, freezing
        # stock-take instead -- a plain read against ordinary entity tables.
    await ctx.session.flush()

    out = await _stocktake_out(ctx, stocktake)
    await complete(ctx.session, claimed_id=claimed_id, status_code=201, body=out.model_dump())
    return out


@router.get("/stocktakes/{stocktake_id}", response_model=StocktakeOut)
async def get_stocktake(
    stocktake_id: str, ctx: RequestContext = Depends(require_capability("stock.adjust"))
) -> StocktakeOut:
    stocktake = await ctx.session.get(Stocktake, stocktake_id)
    if stocktake is None:
        raise HTTPException(status_code=404, detail="Not found.")
    return await _stocktake_out(ctx, stocktake)


@router.post("/stocktakes/{stocktake_id}/lines/{line_id}/count", response_model=StocktakeLineOut)
async def count_stocktake_line(
    stocktake_id: str,
    line_id: str,
    body: StocktakeCountRequest,
    ctx: RequestContext = Depends(require_capability("stock.adjust")),
) -> StocktakeLineOut:
    """Spec D.5.4: "Multiple staff can count different sections of the same
    take simultaneously -- each entry is stamped with who counted it." No
    Idempotency-Key here -- a re-submitted count for the same line is a
    legitimate re-count (the counter fixing a typo), not a risk of
    double-selling/double-charging the way sales/stock movements are; the
    write is a plain overwrite of that one line's counted_quantity, safe to
    repeat."""
    stocktake = await ctx.session.get(Stocktake, stocktake_id)
    if stocktake is None or stocktake.status != "counting":
        raise HTTPException(status_code=409, detail="This stock-take isn't open for counting.")
    line = await ctx.session.get(StocktakeLine, line_id)
    if line is None or line.stocktake_id != stocktake_id:
        raise HTTPException(status_code=404, detail="Not found.")

    counted = Decimal(body.counted_quantity)
    line.counted_quantity = counted
    line.counted_by_user_id = ctx.user_id
    line.counted_at = datetime.now(UTC)
    line.variance_qty = counted - line.expected_quantity

    product = await ctx.session.get(Product, line.product_id)
    unit_cost = product.cost_price_minor if product else 0
    line.variance_value_minor = _round_minor(line.variance_qty * unit_cost)
    await ctx.session.flush()

    return await _line_out(line)


@router.get("/stocktakes/{stocktake_id}/review", response_model=list[StocktakeLineOut])
async def review_stocktake(
    stocktake_id: str, ctx: RequestContext = Depends(require_capability("stock.adjust"))
) -> list[StocktakeLineOut]:
    """Spec D.5.4: "only variances are shown by default ... sorted by
    variance value descending"."""
    stocktake = await ctx.session.get(Stocktake, stocktake_id)
    if stocktake is None:
        raise HTTPException(status_code=404, detail="Not found.")
    lines_result = await ctx.session.execute(
        select(StocktakeLine).where(StocktakeLine.stocktake_id == stocktake_id)
    )
    variances = [
        line
        for line in lines_result.scalars()
        if line.counted_quantity is not None and line.variance_qty not in (None, Decimal("0"))
    ]
    variances.sort(key=lambda line_: abs(line_.variance_value_minor or 0), reverse=True)
    return [await _line_out(line) for line in variances]


@router.post("/stocktakes/{stocktake_id}/lines/{line_id}/reason", response_model=StocktakeLineOut)
async def set_stocktake_line_reason(
    stocktake_id: str,
    line_id: str,
    body: StocktakeLineReasonRequest,
    ctx: RequestContext = Depends(require_capability("stock.adjust")),
) -> StocktakeLineOut:
    line = await ctx.session.get(StocktakeLine, line_id)
    if line is None or line.stocktake_id != stocktake_id:
        raise HTTPException(status_code=404, detail="Not found.")
    line.reason = body.reason
    await ctx.session.flush()
    return await _line_out(line)


@router.post("/stocktakes/{stocktake_id}/post", response_model=StocktakeOut)
async def post_stocktake(
    stocktake_id: str,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("stocktake.post")),
) -> StocktakeOut:
    raw_body = await request.body()
    fingerprint = fingerprint_request(
        "POST", f"/api/v1/stock/stocktakes/{stocktake_id}/post", ctx.business_id, raw_body
    )
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint=f"POST /api/v1/stock/stocktakes/{stocktake_id}/post",
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
        return StocktakeOut(**existing.response_body)

    stocktake = await ctx.session.get(Stocktake, stocktake_id)
    if stocktake is None:
        raise HTTPException(status_code=404, detail="Not found.")
    if stocktake.status not in ("counting", "reviewing"):
        raise HTTPException(
            status_code=409, detail=f"This stock-take is already {stocktake.status}."
        )

    lines_result = await ctx.session.execute(
        select(StocktakeLine).where(StocktakeLine.stocktake_id == stocktake_id)
    )
    lines = list(lines_result.scalars())
    variance_lines = [
        line for line in lines if line.counted_quantity is not None and line.variance_qty != 0
    ]
    for line in variance_lines:
        if (
            abs(line.variance_value_minor or 0) >= VARIANCE_REASON_REQUIRED_THRESHOLD_MINOR
            and not line.reason
        ):
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Line for product {line.product_id} has a variance of "
                    f"{line.variance_value_minor} minor units and needs a reason before posting."
                ),
            )

    total_variance_value = sum(line.variance_value_minor or 0 for line in variance_lines)

    try:
        for line in variance_lines:
            await append_event(
                ctx.session,
                EventEnvelopeInput(
                    business_id=ctx.business_id,
                    type="STOCK_ADJUSTED",
                    payload={
                        "product_id": line.product_id,
                        "location_id": stocktake.location_id,
                        "quantity_delta": str(line.variance_qty),
                        "reason": line.reason or f"Stock-take correction ({stocktake.id})",
                    },
                    actor_user_id=ctx.user_id,
                    actor_source="api",
                    location_id=stocktake.location_id,
                ),
            )
        event = await append_event(
            ctx.session,
            EventEnvelopeInput(
                business_id=ctx.business_id,
                type="STOCKTAKE_POSTED",
                payload={
                    "stocktake_id": stocktake.id,
                    "location_id": stocktake.location_id,
                    "variance_value_minor": total_variance_value,
                    "line_count": len(lines),
                },
                actor_user_id=ctx.user_id,
                actor_source="api",
                location_id=stocktake.location_id,
            ),
        )
    except EnvelopeValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # No unfreeze write needed: freeze state is derived from stocktake.status
    # (see is_frozen_for_stocktake() below), and this line sets it to
    # "posted" -- the query stops matching this stocktake automatically.
    stocktake.status = "posted"
    stocktake.posted_by_user_id = ctx.user_id
    stocktake.posted_at = datetime.now(UTC)
    stocktake.variance_value_minor = total_variance_value
    stocktake.line_count = len(lines)
    stocktake.source_event_id = event.id
    await ctx.session.flush()

    out = await _stocktake_out(ctx, stocktake)
    await complete(ctx.session, claimed_id=claimed_id, status_code=200, body=out.model_dump())
    return out
