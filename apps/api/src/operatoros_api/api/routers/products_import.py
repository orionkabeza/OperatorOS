"""CSV/XLSX product import HTTP surface (spec D.2 Step 3, plan §0.6/§3).

Mounted under the same `/api/v1/products` prefix as `products.py`, kept in
its own file since the two-phase (preview/commit) flow plus the corrected-
template download is substantial on its own. See `product_import.py`
(the parsing/validation module this calls into) for the XLSX library
choice and the no-server-side-staging trade-off.
"""

from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from sqlalchemy import select

from operatoros_api.api.deps import RequestContext, idempotency_key_header, require_capability
from operatoros_api.idempotency_service import (
    claim_or_replay,
    complete,
    fingerprint_request,
    get_existing,
)
from operatoros_api.ledger import EnvelopeValidationError, EventEnvelopeInput, append_event
from operatoros_api.models.catalog import Category, Product, Unit
from operatoros_api.product_import import (
    ParsedRow,
    corrected_template_csv,
    parse_rows,
    validate_rows,
)
from operatoros_api.schemas.products import (
    CorrectedTemplateRequest,
    CorrectedTemplateResult,
    ImportCommitRequest,
    ImportCommitResult,
    ImportPreviewResult,
    ImportPreviewRow,
)

router = APIRouter(prefix="/api/v1/products", tags=["products"])


@router.post("/import/preview", response_model=ImportPreviewResult)
async def preview_import(
    file: UploadFile,
    ctx: RequestContext = Depends(require_capability("product.manage")),
) -> ImportPreviewResult:
    raw = await file.read()
    try:
        raw_rows = parse_rows(file.filename or "", raw)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    existing_sku_result = await ctx.session.execute(
        select(Product.sku).where(Product.sku.is_not(None))
    )
    existing_skus = {row[0] for row in existing_sku_result.all()}
    existing_name_result = await ctx.session.execute(select(Product.name))
    existing_names = {row[0] for row in existing_name_result.all()}

    parsed = validate_rows(raw_rows, existing_skus=existing_skus, existing_names=existing_names)

    preview = [
        ImportPreviewRow(
            row_number=row.row_number,
            name=row.name,
            sku=row.sku,
            barcode=row.barcode,
            category=row.category,
            unit=row.unit,
            cost_price_minor=row.cost_price_minor,
            selling_price_minor=row.selling_price_minor,
            opening_quantity=row.opening_quantity,
            errors=row.errors,
            is_duplicate=row.is_duplicate,
        )
        for row in parsed
    ]
    return ImportPreviewResult(
        total_rows=len(parsed),
        valid_rows=sum(1 for row in parsed if row.is_valid),
        error_rows=sum(1 for row in parsed if not row.is_valid),
        duplicate_rows=sum(1 for row in parsed if row.is_duplicate),
        preview=preview,
    )


@router.post("/import/corrected-template", response_model=CorrectedTemplateResult)
async def corrected_template(
    body: CorrectedTemplateRequest,
    ctx: RequestContext = Depends(require_capability("product.manage")),
) -> CorrectedTemplateResult:
    rows = [
        ParsedRow(
            row_number=r.row_number,
            raw={
                "cost_price": (
                    str(r.cost_price_minor / 100) if r.cost_price_minor is not None else ""
                ),
                "selling_price": (
                    str(r.selling_price_minor / 100) if r.selling_price_minor is not None else ""
                ),
            },
            name=r.name,
            sku=r.sku,
            barcode=r.barcode,
            category=r.category,
            unit=r.unit,
            cost_price_minor=r.cost_price_minor,
            selling_price_minor=r.selling_price_minor,
            opening_quantity=r.opening_quantity,
            errors=r.errors,
            is_duplicate=r.is_duplicate,
        )
        for r in body.rows
    ]
    return CorrectedTemplateResult(csv=corrected_template_csv(rows))


@router.post("/import/commit", response_model=ImportCommitResult, status_code=201)
async def commit_import(
    body: ImportCommitRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("product.manage")),
) -> ImportCommitResult:
    raw_body = await request.body()
    fingerprint = fingerprint_request(
        "POST", "/api/v1/products/import/commit", ctx.business_id, raw_body
    )
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint="POST /api/v1/products/import/commit",
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
        return ImportCommitResult(**existing.response_body)

    if await ctx.session.get(Unit, body.default_unit_id) is None:
        raise HTTPException(status_code=422, detail="Unknown default_unit_id.")

    # Re-check duplicates against the CURRENT database state (not just what
    # the preview saw) -- time may have passed between preview and commit,
    # and another request may have created a colliding SKU/name meanwhile.
    existing_sku_result = await ctx.session.execute(
        select(Product.sku).where(Product.sku.is_not(None))
    )
    existing_skus = {row[0] for row in existing_sku_result.all()}
    existing_name_result = await ctx.session.execute(select(Product.name))
    existing_names = {row[0] for row in existing_name_result.all()}

    category_cache: dict[str, str] = {}
    created = 0
    skipped = 0

    for row in body.rows:
        if row.errors or row.is_duplicate or not row.name:
            skipped += 1
            continue
        if (row.sku and row.sku in existing_skus) or row.name in existing_names:
            skipped += 1
            continue

        category_id = None
        if row.category:
            category_id = category_cache.get(row.category)
            if category_id is None:
                cat_result = await ctx.session.execute(
                    select(Category).where(
                        Category.business_id == ctx.business_id, Category.name == row.category
                    )
                )
                cat = cat_result.scalar_one_or_none()
                if cat is None:
                    cat = Category(business_id=ctx.business_id, name=row.category)
                    ctx.session.add(cat)
                    await ctx.session.flush()
                category_id = cat.id
                category_cache[row.category] = category_id

        product = Product(
            business_id=ctx.business_id,
            category_id=category_id,
            base_unit_id=body.default_unit_id,
            name=row.name,
            sku=row.sku,
            barcode=row.barcode,
            cost_price_minor=row.cost_price_minor or 0,
            selling_price_minor=row.selling_price_minor or 0,
        )
        ctx.session.add(product)
        await ctx.session.flush()
        existing_names.add(row.name)
        if row.sku:
            existing_skus.add(row.sku)

        try:
            await append_event(
                ctx.session,
                EventEnvelopeInput(
                    business_id=ctx.business_id,
                    type="PRODUCT_CREATED",
                    payload={"product_id": product.id, "name": product.name, "sku": product.sku},
                    actor_user_id=ctx.user_id,
                    actor_source="api",
                ),
            )
            if (
                row.opening_quantity
                and body.opening_location_id
                and Decimal(row.opening_quantity) > 0
            ):
                await append_event(
                    ctx.session,
                    EventEnvelopeInput(
                        business_id=ctx.business_id,
                        type="STOCK_RECEIVED",
                        payload={
                            "product_id": product.id,
                            "location_id": body.opening_location_id,
                            "quantity": row.opening_quantity,
                            "unit_cost_minor": row.cost_price_minor or 0,
                            "reference": "csv_import",
                        },
                        actor_user_id=ctx.user_id,
                        actor_source="api",
                        location_id=body.opening_location_id,
                    ),
                )
        except EnvelopeValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        created += 1

    out = ImportCommitResult(created=created, skipped=skipped)
    await complete(ctx.session, claimed_id=claimed_id, status_code=201, body=out.model_dump())
    return out
