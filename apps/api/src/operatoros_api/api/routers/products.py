"""Products, categories, units (spec D.5.1/D.5.2, plan §3).

Cost/margin fields are visibility-gated behind `product.view_cost` (spec
F.2) on every read — a Cashier can look up a product to sell it without
ever seeing what it cost. CSV/XLSX import lives in `products_import.py`,
mounted under this same router prefix, to keep this file to plain CRUD.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

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
from operatoros_api.models.catalog import Category, Product, ProductAlias, ProductLocation, Unit
from operatoros_api.schemas.products import (
    BulkCategoryChangeRequest,
    BulkPriceAdjustRequest,
    CategoryCreate,
    CategoryOut,
    PriceChangeRequest,
    ProductCreate,
    ProductOut,
    ProductStockOut,
    ProductUpdate,
    UnitCreate,
    UnitOut,
)

router = APIRouter(prefix="/api/v1/products", tags=["products"])


async def _claim(ctx: RequestContext, request: Request, endpoint: str, idempotency_key: str):
    """Shared claim/fingerprint helper -- same idempotency pattern as
    api/routers/users.py, factored out once here since this router has many
    small mutating endpoints."""
    raw_body = await request.body()
    fingerprint = fingerprint_request(request.method, endpoint, ctx.business_id, raw_body)
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint=endpoint,
        fingerprint=fingerprint,
    )
    return claimed_id, fingerprint


async def _replay_or_conflict(ctx: RequestContext, idempotency_key: str, fingerprint: str) -> dict:
    existing = await get_existing(ctx.session, business_id=ctx.business_id, key=idempotency_key)
    if existing.request_fingerprint != fingerprint:
        raise HTTPException(
            status_code=409, detail="This Idempotency-Key was already used for a different request."
        )
    if existing.response_body is None:
        raise RuntimeError("idempotency row has no response_body despite being complete")
    return existing.response_body


async def _to_product_out(ctx: RequestContext, product: Product) -> ProductOut:
    alias_result = await ctx.session.execute(
        select(ProductAlias.alias).where(ProductAlias.product_id == product.id)
    )
    aliases = [row[0] for row in alias_result.all()]
    can_see_cost = ctx.capabilities.has("product.view_cost", location_id=None)
    return ProductOut(
        id=product.id,
        name=product.name,
        sku=product.sku,
        barcode=product.barcode,
        category_id=product.category_id,
        base_unit_id=product.base_unit_id,
        cost_price_minor=product.cost_price_minor if can_see_cost else None,
        selling_price_minor=product.selling_price_minor,
        min_selling_price_minor=product.min_selling_price_minor,
        tax_class=product.tax_class,
        reorder_point=str(product.reorder_point),
        reorder_quantity=str(product.reorder_quantity),
        status=product.status,
        aliases=aliases,
    )


# --- categories / units ------------------------------------------------------


@router.get("/categories", response_model=list[CategoryOut])
async def list_categories(ctx: RequestContext = Depends(get_current_context)) -> list[CategoryOut]:
    result = await ctx.session.execute(select(Category).order_by(Category.name))
    return [CategoryOut(id=c.id, name=c.name) for c in result.scalars()]


@router.post("/categories", response_model=CategoryOut, status_code=201)
async def create_category(
    body: CategoryCreate, ctx: RequestContext = Depends(require_capability("product.manage"))
) -> CategoryOut:
    category = Category(business_id=ctx.business_id, name=body.name)
    ctx.session.add(category)
    await ctx.session.flush()
    return CategoryOut(id=category.id, name=category.name)


@router.get("/units", response_model=list[UnitOut])
async def list_units(ctx: RequestContext = Depends(get_current_context)) -> list[UnitOut]:
    result = await ctx.session.execute(select(Unit).order_by(Unit.name))
    return [UnitOut(id=u.id, name=u.name, symbol=u.symbol) for u in result.scalars()]


@router.post("/units", response_model=UnitOut, status_code=201)
async def create_unit(
    body: UnitCreate, ctx: RequestContext = Depends(require_capability("product.manage"))
) -> UnitOut:
    unit = Unit(business_id=ctx.business_id, name=body.name, symbol=body.symbol)
    ctx.session.add(unit)
    await ctx.session.flush()
    return UnitOut(id=unit.id, name=unit.name, symbol=unit.symbol)


# --- products -----------------------------------------------------------------


@router.get("", response_model=list[ProductOut])
async def list_products(
    search: str | None = Query(default=None),
    category_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    below_cost: bool = Query(default=False),
    ctx: RequestContext = Depends(get_current_context),
) -> list[ProductOut]:
    stmt = select(Product)
    if search:
        like = f"%{search}%"
        stmt = stmt.where(or_(Product.name.ilike(like), Product.sku.ilike(like)))
    if category_id:
        stmt = stmt.where(Product.category_id == category_id)
    if status:
        stmt = stmt.where(Product.status == status)
    if below_cost:
        stmt = stmt.where(Product.selling_price_minor < Product.cost_price_minor)
    result = await ctx.session.execute(stmt.order_by(Product.name).limit(500))
    return [await _to_product_out(ctx, p) for p in result.scalars()]


@router.get("/{product_id}", response_model=ProductOut)
async def get_product(
    product_id: str, ctx: RequestContext = Depends(get_current_context)
) -> ProductOut:
    product = await ctx.session.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Not found.")
    return await _to_product_out(ctx, product)


@router.get("/{product_id}/stock", response_model=list[ProductStockOut])
async def get_product_stock(
    product_id: str, ctx: RequestContext = Depends(get_current_context)
) -> list[ProductStockOut]:
    result = await ctx.session.execute(
        select(ProductLocation).where(ProductLocation.product_id == product_id)
    )
    return [
        ProductStockOut(
            product_id=row.product_id,
            location_id=row.location_id,
            on_hand=str(row.on_hand),
            reserved=str(row.reserved),
            available=str(row.on_hand - row.reserved),
            avg_cost_minor=row.avg_cost_minor,
        )
        for row in result.scalars()
    ]


@router.post("", response_model=ProductOut, status_code=201)
async def create_product(
    body: ProductCreate,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("product.manage")),
) -> ProductOut:
    claimed_id, fingerprint = await _claim(ctx, request, "POST /api/v1/products", idempotency_key)
    if claimed_id is None:
        return ProductOut(**await _replay_or_conflict(ctx, idempotency_key, fingerprint))

    unit = await ctx.session.get(Unit, body.base_unit_id)
    if unit is None:
        raise HTTPException(status_code=422, detail="Unknown unit.")
    if body.category_id is not None and await ctx.session.get(Category, body.category_id) is None:
        raise HTTPException(status_code=422, detail="Unknown category.")

    try:
        reorder_point = Decimal(body.reorder_point)
        reorder_quantity = Decimal(body.reorder_quantity)
    except InvalidOperation as exc:
        raise HTTPException(
            status_code=422, detail="reorder_point/reorder_quantity must be decimal strings."
        ) from exc

    product = Product(
        business_id=ctx.business_id,
        category_id=body.category_id,
        base_unit_id=body.base_unit_id,
        name=body.name,
        sku=body.sku,
        barcode=body.barcode,
        cost_price_minor=body.cost_price_minor,
        selling_price_minor=body.selling_price_minor,
        min_selling_price_minor=body.min_selling_price_minor,
        tax_class=body.tax_class,
        reorder_point=reorder_point,
        reorder_quantity=reorder_quantity,
        notes=body.notes,
    )
    ctx.session.add(product)
    await ctx.session.flush()

    for alias in body.aliases:
        ctx.session.add(
            ProductAlias(business_id=ctx.business_id, product_id=product.id, alias=alias)
        )

    try:
        await append_event(
            ctx.session,
            EventEnvelopeInput(
                business_id=ctx.business_id,
                type="PRODUCT_CREATED",
                payload={"product_id": product.id, "name": product.name, "sku": product.sku},
                actor_user_id=ctx.user_id,
                actor_source="api",
                location_id=ctx.location_ids[0] if ctx.location_ids else None,
            ),
        )
        if body.opening_quantity and body.opening_location_id:
            await append_event(
                ctx.session,
                EventEnvelopeInput(
                    business_id=ctx.business_id,
                    type="STOCK_RECEIVED",
                    payload={
                        "product_id": product.id,
                        "location_id": body.opening_location_id,
                        "quantity": body.opening_quantity,
                        "unit_cost_minor": body.cost_price_minor,
                        "reference": "opening_balance",
                    },
                    actor_user_id=ctx.user_id,
                    actor_source="api",
                    location_id=body.opening_location_id,
                ),
            )
    except EnvelopeValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    out = await _to_product_out(ctx, product)
    await complete(ctx.session, claimed_id=claimed_id, status_code=201, body=out.model_dump())
    return out


@router.patch("/{product_id}", response_model=ProductOut)
async def update_product(
    product_id: str,
    body: ProductUpdate,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("product.manage")),
) -> ProductOut:
    claimed_id, fingerprint = await _claim(
        ctx, request, f"PATCH /api/v1/products/{product_id}", idempotency_key
    )
    if claimed_id is None:
        return ProductOut(**await _replay_or_conflict(ctx, idempotency_key, fingerprint))

    product = await ctx.session.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Not found.")

    for field in (
        "name",
        "category_id",
        "sku",
        "barcode",
        "min_selling_price_minor",
        "tax_class",
        "notes",
    ):
        value = getattr(body, field)
        if value is not None:
            setattr(product, field, value)
    if body.reorder_point is not None:
        product.reorder_point = Decimal(body.reorder_point)
    if body.reorder_quantity is not None:
        product.reorder_quantity = Decimal(body.reorder_quantity)
    await ctx.session.flush()

    out = await _to_product_out(ctx, product)
    await complete(ctx.session, claimed_id=claimed_id, status_code=200, body=out.model_dump())
    return out


@router.post("/{product_id}/price", response_model=ProductOut)
async def change_price(
    product_id: str,
    body: PriceChangeRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("product.manage")),
) -> ProductOut:
    claimed_id, fingerprint = await _claim(
        ctx, request, f"POST /api/v1/products/{product_id}/price", idempotency_key
    )
    if claimed_id is None:
        return ProductOut(**await _replay_or_conflict(ctx, idempotency_key, fingerprint))

    product = await ctx.session.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Not found.")

    old_price = product.selling_price_minor
    product.selling_price_minor = body.new_selling_price_minor
    await ctx.session.flush()

    try:
        await append_event(
            ctx.session,
            EventEnvelopeInput(
                business_id=ctx.business_id,
                type="PRICE_CHANGED",
                payload={
                    "product_id": product.id,
                    "old_price_minor": old_price,
                    "new_price_minor": body.new_selling_price_minor,
                },
                actor_user_id=ctx.user_id,
                actor_source="api",
            ),
        )
    except EnvelopeValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    out = await _to_product_out(ctx, product)
    await complete(ctx.session, claimed_id=claimed_id, status_code=200, body=out.model_dump())
    return out


@router.post("/{product_id}/archive", response_model=ProductOut)
async def archive_product(
    product_id: str,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("product.manage")),
) -> ProductOut:
    claimed_id, fingerprint = await _claim(
        ctx, request, f"POST /api/v1/products/{product_id}/archive", idempotency_key
    )
    if claimed_id is None:
        return ProductOut(**await _replay_or_conflict(ctx, idempotency_key, fingerprint))

    product = await ctx.session.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Not found.")
    product.status = "archived"
    await ctx.session.flush()

    try:
        await append_event(
            ctx.session,
            EventEnvelopeInput(
                business_id=ctx.business_id,
                type="PRODUCT_ARCHIVED",
                payload={"product_id": product.id},
                actor_user_id=ctx.user_id,
                actor_source="api",
            ),
        )
    except EnvelopeValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    out = await _to_product_out(ctx, product)
    await complete(ctx.session, claimed_id=claimed_id, status_code=200, body=out.model_dump())
    return out


@router.post("/bulk/price", status_code=200)
async def bulk_price_adjust(
    body: BulkPriceAdjustRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("product.manage")),
) -> dict:
    claimed_id, fingerprint = await _claim(
        ctx, request, "POST /api/v1/products/bulk/price", idempotency_key
    )
    if claimed_id is None:
        return await _replay_or_conflict(ctx, idempotency_key, fingerprint)

    updated = 0
    for product_id in body.product_ids:
        product = await ctx.session.get(Product, product_id)
        if product is None:
            continue
        old_price = product.selling_price_minor
        if body.percent is not None:
            factor = Decimal("1") + (Decimal(body.percent) / Decimal("100"))
            new_price = int(
                (Decimal(old_price) * factor).to_integral_value(rounding="ROUND_HALF_UP")
            )
        elif body.amount_minor is not None:
            new_price = old_price + body.amount_minor
        else:
            continue
        product.selling_price_minor = new_price
        await append_event(
            ctx.session,
            EventEnvelopeInput(
                business_id=ctx.business_id,
                type="PRICE_CHANGED",
                payload={
                    "product_id": product.id,
                    "old_price_minor": old_price,
                    "new_price_minor": new_price,
                },
                actor_user_id=ctx.user_id,
                actor_source="api",
            ),
        )
        updated += 1

    body_out = {"updated": updated}
    await complete(ctx.session, claimed_id=claimed_id, status_code=200, body=body_out)
    return body_out


@router.post("/bulk/category", status_code=200)
async def bulk_category_change(
    body: BulkCategoryChangeRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("product.manage")),
) -> dict:
    claimed_id, fingerprint = await _claim(
        ctx, request, "POST /api/v1/products/bulk/category", idempotency_key
    )
    if claimed_id is None:
        return await _replay_or_conflict(ctx, idempotency_key, fingerprint)

    updated = 0
    for product_id in body.product_ids:
        product = await ctx.session.get(Product, product_id)
        if product is None:
            continue
        product.category_id = body.category_id
        updated += 1

    body_out = {"updated": updated}
    await complete(ctx.session, claimed_id=claimed_id, status_code=200, body=body_out)
    return body_out
