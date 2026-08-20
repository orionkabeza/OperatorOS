"""The Counter: sales, quotes, and returns (spec D.4, plan §3).

`create_sale` is the single most safety-critical endpoint in Phase 1: one
atomic transaction that (a) validates the basket against current stock and
prices, (b) checks the customer's credit limit if any line is paid "on
credit" and blocks over-limit without a verified manager-PIN override
captured on the sale, (c) writes `SALE_RECORDED` plus the
stock/customer-balance/money/daily-totals side effects it drives, all in
one transaction, and (d) is idempotent via the standard `Idempotency-Key`
claim -- a retried request with the same key replays the original response
rather than re-selling. See tests/test_sales_atomicity.py for the concurrent
double-submit proof.

**Simplifications disclosed in docs/DECISIONS.md, not silently invented:**
- VAT is a fixed 18%/`standard` vs 0%/`exempt` rate keyed on
  `Product.tax_class`, not a business-configurable rate table (no tax
  settings screen exists yet).
- A sale-level `discount_minor` is applied to the subtotal after each
  line's own tax has already been computed on that line's own (pre-sale-
  discount) net price -- a fully accurate discount-before-tax allocation
  across lines is deferred.
- `payments` must sum to exactly `total_minor` -- no over/under payment;
  "change due" is a client-side UI computation from "cash given", not a
  field this phase's API stores.
- A till session is looked up but not required to exist for a sale to
  succeed (`Sale.till_session_id` is nullable) -- only the day needs to be
  open. Requiring an open till session too was judged an unnecessary extra
  hard dependency for the MVP "sell a product" path; till reconciliation
  still works correctly when a till session IS open.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, text

from operatoros_api.api.deps import RequestContext, idempotency_key_header, require_capability
from operatoros_api.api.routers.stock_stocktake import is_frozen_for_stocktake
from operatoros_api.audit_log import append_audit_log
from operatoros_api.capabilities import resolve_effective_capabilities
from operatoros_api.idempotency_service import (
    claim_or_replay,
    complete,
    fingerprint_request,
    get_existing,
)
from operatoros_api.ledger import EnvelopeValidationError, EventEnvelopeInput, append_event
from operatoros_api.models.base import uuid7_str
from operatoros_api.models.catalog import Product, ProductLocation
from operatoros_api.models.customers import CustomerBalance
from operatoros_api.models.day_till import DaySession, TillSession
from operatoros_api.models.sales import (
    Quote,
    QuoteLine,
    Receipt,
    Return,
    ReturnLine,
    Sale,
    SaleLine,
    SalePayment,
)
from operatoros_api.models.tenancy import User
from operatoros_api.schemas.sales import (
    QuoteCreateRequest,
    QuoteLineOut,
    QuoteOut,
    ReturnCreateRequest,
    ReturnOut,
    SaleCreateRequest,
    SaleLineOut,
    SaleOut,
    SalePaymentOut,
)
from operatoros_api.security.passwords import verify_secret

router = APIRouter(prefix="/api/v1/sales", tags=["sales"])

VAT_RATES: dict[str, Decimal] = {"standard": Decimal("0.18"), "exempt": Decimal("0")}
DISCOUNT_APPROVAL_THRESHOLD_PERCENT = Decimal("10")
VALID_PAYMENT_METHODS = frozenset({"cash", "momo", "airtel", "bank", "card", "cheque", "credit"})


def _round_minor(value: Decimal) -> int:
    return int(value.to_integral_value(rounding=ROUND_HALF_UP))


async def _next_sequence_number(session, business_id: str) -> int:
    """Shared per-business, gap-free, race-free counter for both receipt and
    quote numbers -- see models/sales.py::ReceiptSequence docstring. Using
    one sequence for both is a deliberate simplification (no separate
    quote-number series); document as such if a business ever needs quote
    numbers to be independent of receipt numbers."""
    result = await session.execute(
        text(
            "INSERT INTO receipt_sequences (business_id, next_number) VALUES (:bid, 2) "
            "ON CONFLICT (business_id) DO UPDATE "
            "SET next_number = receipt_sequences.next_number + 1 "
            "RETURNING next_number - 1"
        ),
        {"bid": business_id},
    )
    return int(result.scalar_one())


async def _verify_manager_override(
    ctx: RequestContext, manager_user_id: str | None, pin: str | None, required_capability: str
) -> bool:
    if not manager_user_id or not pin:
        return False
    manager = await ctx.session.get(User, manager_user_id)
    if manager is None or manager.status != "active":
        return False
    if not verify_secret(pin, manager.secret_hash):
        return False
    caps = await resolve_effective_capabilities(
        ctx.session, user_id=manager.id, role_key=manager.role.key, assigned_location_ids=[]
    )
    return caps.has(required_capability, location_id=None)


@dataclass
class _PricedLine:
    product_id: str
    quantity: Decimal
    unit_price_minor: int
    line_discount_minor: int
    tax_minor: int
    line_total_minor: int
    gross_minor: int


async def _price_lines(
    ctx: RequestContext, body_lines, override_verified: bool
) -> list[_PricedLine]:
    priced: list[_PricedLine] = []
    for line in body_lines:
        product = await ctx.session.get(Product, line.product_id)
        if product is None or product.status != "active":
            raise HTTPException(
                status_code=422, detail=f"Unknown or archived product {line.product_id}."
            )
        try:
            quantity = Decimal(line.quantity)
        except InvalidOperation as exc:
            raise HTTPException(
                status_code=422, detail=f"Invalid quantity for {product.name}."
            ) from exc
        if quantity <= 0:
            raise HTTPException(
                status_code=422, detail=f"Quantity for {product.name} must be positive."
            )

        unit_price_minor = product.selling_price_minor
        if line.unit_price_minor is not None:
            if not ctx.capabilities.has("sale.price_override", location_id=None):
                raise HTTPException(
                    status_code=403, detail="You don't have permission to override a sale price."
                )
            unit_price_minor = line.unit_price_minor

        if (
            product.min_selling_price_minor is not None
            and unit_price_minor < product.min_selling_price_minor
            and not override_verified
        ):
            raise HTTPException(
                status_code=422,
                detail=(
                    f"{product.name}'s price of {unit_price_minor} is below its minimum of "
                    f"{product.min_selling_price_minor} -- a manager PIN is required."
                ),
            )

        gross = _round_minor(quantity * unit_price_minor)
        net = gross - line.line_discount_minor
        if net < 0:
            raise HTTPException(
                status_code=422, detail=f"Discount on {product.name} exceeds its price."
            )
        tax = _round_minor(Decimal(net) * VAT_RATES.get(product.tax_class, Decimal("0")))

        priced.append(
            _PricedLine(
                product_id=product.id,
                quantity=quantity,
                unit_price_minor=unit_price_minor,
                line_discount_minor=line.line_discount_minor,
                tax_minor=tax,
                line_total_minor=net + tax,
                gross_minor=gross,
            )
        )
    return priced


async def _check_stock(
    ctx: RequestContext, location_id: str, priced: list[_PricedLine], allow_negative: bool
) -> None:
    for line in priced:
        result = await ctx.session.execute(
            select(ProductLocation).where(
                ProductLocation.location_id == location_id,
                ProductLocation.product_id == line.product_id,
            )
        )
        row = result.scalar_one_or_none()
        if await is_frozen_for_stocktake(ctx.session, location_id, line.product_id):
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Product {line.product_id} is frozen for a stock-take in progress at this "
                    "location and can't be sold until the count is posted."
                ),
            )
        on_hand = row.on_hand if row else Decimal("0")
        reserved = row.reserved if row else Decimal("0")
        available = on_hand - reserved
        if line.quantity > available and (
            not allow_negative or not ctx.capabilities.has("stock.adjust", location_id=None)
        ):
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Stock check failed -- you have {available} of product {line.product_id}, "
                    f"this sale needs {line.quantity}. Reduce the quantity or record a "
                    "stock-in first."
                ),
            )


def _sale_out(
    sale: Sale, receipt_number: int, lines: list[SaleLine], payments: list[SalePayment]
) -> SaleOut:
    return SaleOut(
        id=sale.id,
        location_id=sale.location_id,
        customer_id=sale.customer_id,
        receipt_number=receipt_number,
        subtotal_minor=sale.subtotal_minor,
        discount_minor=sale.discount_minor,
        tax_minor=sale.tax_minor,
        total_minor=sale.total_minor,
        status=sale.status,
        lines=[
            SaleLineOut(
                product_id=line_.product_id,
                quantity=str(line_.quantity),
                unit_price_minor=line_.unit_price_minor,
                line_discount_minor=line_.line_discount_minor,
                tax_minor=line_.tax_minor,
                line_total_minor=line_.line_total_minor,
            )
            for line_ in lines
        ],
        payments=[
            SalePaymentOut(method=p.method, amount_minor=p.amount_minor, reference=p.reference)
            for p in payments
        ],
    )


@router.post("", response_model=SaleOut, status_code=201)
async def create_sale(
    body: SaleCreateRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("sale.create")),
) -> SaleOut:
    raw_body = await request.body()
    fingerprint = fingerprint_request("POST", "/api/v1/sales", ctx.business_id, raw_body)
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint="POST /api/v1/sales",
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
        return SaleOut(**existing.response_body)

    if not body.lines:
        raise HTTPException(status_code=422, detail="A sale needs at least one line.")
    for pay in body.payments:
        if pay.method not in VALID_PAYMENT_METHODS:
            raise HTTPException(status_code=422, detail=f"Unknown payment method {pay.method!r}.")

    day_result = await ctx.session.execute(
        select(DaySession).where(
            DaySession.location_id == body.location_id, DaySession.status == "open"
        )
    )
    day = day_result.scalars().first()
    if day is None:
        raise HTTPException(
            status_code=409, detail="The shop isn't open at this location -- open the day first."
        )

    till_result = await ctx.session.execute(
        select(TillSession).where(
            TillSession.location_id == body.location_id,
            TillSession.cashier_user_id == ctx.user_id,
            TillSession.status == "open",
        )
    )
    till = till_result.scalars().first()

    override_verified = await _verify_manager_override(
        ctx, body.manager_override_user_id, body.manager_override_pin, "sale.price_override"
    )

    priced = await _price_lines(ctx, body.lines, override_verified)
    await _check_stock(ctx, body.location_id, priced, body.allow_negative_stock)

    subtotal_minor = sum(line_.gross_minor for line_ in priced)
    line_discounts = sum(line_.line_discount_minor for line_ in priced)
    discount_minor = line_discounts + body.discount_minor
    tax_minor = sum(line_.tax_minor for line_ in priced)
    total_minor = subtotal_minor - discount_minor + tax_minor

    if (
        subtotal_minor > 0
        and Decimal(discount_minor * 100) / Decimal(subtotal_minor)
        > DISCOUNT_APPROVAL_THRESHOLD_PERCENT
    ):
        discount_override_ok = await _verify_manager_override(
            ctx,
            body.manager_override_user_id,
            body.manager_override_pin,
            "sale.discount.over_threshold",
        )
        if not discount_override_ok:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"A discount above {DISCOUNT_APPROVAL_THRESHOLD_PERCENT}% requires a "
                    "manager PIN."
                ),
            )

    payments_total = sum(p.amount_minor for p in body.payments)
    if payments_total != total_minor:
        raise HTTPException(
            status_code=422,
            detail=f"Payments total {payments_total} but the sale total is {total_minor}.",
        )

    credit_amount = sum(p.amount_minor for p in body.payments if p.method == "credit")
    credit_override_used = False
    if credit_amount > 0:
        if not body.customer_id:
            raise HTTPException(status_code=422, detail="A credit sale needs a customer.")
        balance_result = await ctx.session.execute(
            select(CustomerBalance).where(CustomerBalance.customer_id == body.customer_id)
        )
        balance = balance_result.scalar_one_or_none()
        credit_limit = balance.credit_limit_minor if balance else 0
        current_balance = balance.balance_minor if balance else 0
        new_balance = current_balance + credit_amount
        if new_balance > credit_limit:
            override_ok = await _verify_manager_override(
                ctx,
                body.manager_override_user_id,
                body.manager_override_pin,
                "debt.credit_override",
            )
            if not override_ok:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"This sale would take the customer's balance to {new_balance}, over "
                        f"their credit limit of {credit_limit}. A manager PIN override is required."
                    ),
                )
            if not body.override_reason:
                raise HTTPException(
                    status_code=422, detail="A reason is required to override the credit limit."
                )
            credit_override_used = True

    sale_id = uuid7_str()
    receipt_number = await _next_sequence_number(ctx.session, ctx.business_id)

    sale = Sale(
        id=sale_id,
        business_id=ctx.business_id,
        location_id=body.location_id,
        day_session_id=day.id,
        till_session_id=till.id if till else None,
        customer_id=body.customer_id,
        cashier_user_id=ctx.user_id,
        subtotal_minor=subtotal_minor,
        discount_minor=discount_minor,
        tax_minor=tax_minor,
        total_minor=total_minor,
        status="completed",
        credit_override_by_user_id=body.manager_override_user_id if credit_override_used else None,
        credit_override_reason=body.override_reason if credit_override_used else None,
        source_event_id="",
    )
    ctx.session.add(sale)
    await ctx.session.flush()

    sale_lines: list[SaleLine] = []
    for line_ in priced:
        sale_line = SaleLine(
            business_id=ctx.business_id,
            sale_id=sale.id,
            product_id=line_.product_id,
            quantity=line_.quantity,
            unit_price_minor=line_.unit_price_minor,
            line_discount_minor=line_.line_discount_minor,
            tax_minor=line_.tax_minor,
            line_total_minor=line_.line_total_minor,
        )
        ctx.session.add(sale_line)
        sale_lines.append(sale_line)

    sale_payments: list[SalePayment] = []
    for pay in body.payments:
        sale_payment = SalePayment(
            business_id=ctx.business_id,
            sale_id=sale.id,
            method=pay.method,
            amount_minor=pay.amount_minor,
            reference=pay.reference,
        )
        ctx.session.add(sale_payment)
        sale_payments.append(sale_payment)

    receipt = Receipt(business_id=ctx.business_id, sale_id=sale.id, receipt_number=receipt_number)
    ctx.session.add(receipt)
    await ctx.session.flush()

    try:
        event = await append_event(
            ctx.session,
            EventEnvelopeInput(
                business_id=ctx.business_id,
                type="SALE_RECORDED",
                payload={
                    "sale_id": sale.id,
                    "customer_id": body.customer_id,
                    "lines": [
                        {
                            "product_id": line_.product_id,
                            "quantity": str(line_.quantity),
                            "unit_price_minor": line_.unit_price_minor,
                            "line_total_minor": line_.line_total_minor,
                        }
                        for line_ in priced
                    ],
                    "payments": [
                        {
                            "method": p.method,
                            "amount_minor": p.amount_minor,
                            "reference": p.reference,
                        }
                        for p in body.payments
                    ],
                    "subtotal_minor": subtotal_minor,
                    "discount_minor": discount_minor,
                    "tax_minor": tax_minor,
                    "total_minor": total_minor,
                },
                actor_user_id=ctx.user_id,
                actor_source="api",
                location_id=body.location_id,
            ),
        )
    except EnvelopeValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    sale.source_event_id = event.id
    await ctx.session.flush()

    if credit_override_used:
        await append_audit_log(
            ctx.session,
            business_id=ctx.business_id,
            event_type="PERMISSION_OVERRIDDEN",
            actor_user_id=ctx.user_id,
            subject_user_id=body.manager_override_user_id,
            detail={
                "permission_key": "debt.credit_override",
                "sale_id": sale.id,
                "reason": body.override_reason,
            },
        )

    out = _sale_out(sale, receipt_number, sale_lines, sale_payments)
    await complete(ctx.session, claimed_id=claimed_id, status_code=201, body=out.model_dump())
    return out


# --- quotes -------------------------------------------------------------------


@router.post("/quotes", response_model=QuoteOut, status_code=201)
async def create_quote(
    body: QuoteCreateRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("sale.create")),
) -> QuoteOut:
    raw_body = await request.body()
    fingerprint = fingerprint_request("POST", "/api/v1/sales/quotes", ctx.business_id, raw_body)
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint="POST /api/v1/sales/quotes",
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
        return QuoteOut(**existing.response_body)

    if not body.lines:
        raise HTTPException(status_code=422, detail="A quote needs at least one line.")

    lines_out: list[QuoteLine] = []
    subtotal_minor = 0
    for line in body.lines:
        product = await ctx.session.get(Product, line.product_id)
        if product is None:
            raise HTTPException(status_code=422, detail=f"Unknown product {line.product_id}.")
        quantity = Decimal(line.quantity)
        line_total = _round_minor(quantity * line.unit_price_minor)
        subtotal_minor += line_total
        lines_out.append(
            QuoteLine(
                business_id=ctx.business_id,
                product_id=line.product_id,
                quantity=quantity,
                unit_price_minor=line.unit_price_minor,
                line_total_minor=line_total,
            )
        )

    discount_minor = body.discount_minor
    tax_minor = _round_minor(Decimal(subtotal_minor - discount_minor) * VAT_RATES["standard"])
    total_minor = subtotal_minor - discount_minor + tax_minor
    quote_number = await _next_sequence_number(ctx.session, ctx.business_id)
    expires_at = datetime.now(UTC) + timedelta(days=body.expires_in_days)

    quote = Quote(
        business_id=ctx.business_id,
        location_id=body.location_id,
        customer_id=body.customer_id,
        quote_number=quote_number,
        created_by_user_id=ctx.user_id,
        subtotal_minor=subtotal_minor,
        discount_minor=discount_minor,
        tax_minor=tax_minor,
        total_minor=total_minor,
        status="open",
        expires_at=expires_at,
        source_event_id="",
    )
    ctx.session.add(quote)
    await ctx.session.flush()
    for line_row in lines_out:
        line_row.quote_id = quote.id
        ctx.session.add(line_row)
    await ctx.session.flush()

    try:
        event = await append_event(
            ctx.session,
            EventEnvelopeInput(
                business_id=ctx.business_id,
                type="QUOTE_ISSUED",
                payload={
                    "quote_id": quote.id,
                    "customer_id": body.customer_id,
                    "total_minor": total_minor,
                    "expires_at": expires_at.isoformat(),
                },
                actor_user_id=ctx.user_id,
                actor_source="api",
                location_id=body.location_id,
            ),
        )
    except EnvelopeValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    quote.source_event_id = event.id
    await ctx.session.flush()

    out = QuoteOut(
        id=quote.id,
        quote_number=quote.quote_number,
        location_id=quote.location_id,
        customer_id=quote.customer_id,
        subtotal_minor=quote.subtotal_minor,
        discount_minor=quote.discount_minor,
        tax_minor=quote.tax_minor,
        total_minor=quote.total_minor,
        status=quote.status,
        expires_at=quote.expires_at.isoformat(),
        lines=[
            QuoteLineOut(
                product_id=line_row.product_id,
                quantity=str(line_row.quantity),
                unit_price_minor=line_row.unit_price_minor,
                line_total_minor=line_row.line_total_minor,
            )
            for line_row in lines_out
        ],
    )
    await complete(ctx.session, claimed_id=claimed_id, status_code=201, body=out.model_dump())
    return out


@router.get("/quotes/{quote_id}", response_model=QuoteOut)
async def get_quote(
    quote_id: str, ctx: RequestContext = Depends(require_capability("sale.create"))
) -> QuoteOut:
    quote = await ctx.session.get(Quote, quote_id)
    if quote is None:
        raise HTTPException(status_code=404, detail="Not found.")
    lines_result = await ctx.session.execute(
        select(QuoteLine).where(QuoteLine.quote_id == quote_id)
    )
    lines = list(lines_result.scalars())
    if quote.status == "open" and quote.expires_at < datetime.now(UTC):
        quote.status = "expired"
        await ctx.session.flush()
    return QuoteOut(
        id=quote.id,
        quote_number=quote.quote_number,
        location_id=quote.location_id,
        customer_id=quote.customer_id,
        subtotal_minor=quote.subtotal_minor,
        discount_minor=quote.discount_minor,
        tax_minor=quote.tax_minor,
        total_minor=quote.total_minor,
        status=quote.status,
        expires_at=quote.expires_at.isoformat(),
        lines=[
            QuoteLineOut(
                product_id=line_row.product_id,
                quantity=str(line_row.quantity),
                unit_price_minor=line_row.unit_price_minor,
                line_total_minor=line_row.line_total_minor,
            )
            for line_row in lines
        ],
    )


@router.post("/quotes/{quote_id}/convert", response_model=SaleOut, status_code=201)
async def convert_quote(
    quote_id: str,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("sale.create")),
) -> SaleOut:
    raw_body = await request.body()
    fingerprint = fingerprint_request(
        "POST", f"/api/v1/sales/quotes/{quote_id}/convert", ctx.business_id, raw_body
    )
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint=f"POST /api/v1/sales/quotes/{quote_id}/convert",
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
        return SaleOut(**existing.response_body)

    quote = await ctx.session.get(Quote, quote_id)
    if quote is None:
        raise HTTPException(status_code=404, detail="Not found.")
    if quote.status != "open":
        raise HTTPException(status_code=409, detail=f"This quote is {quote.status}, not open.")

    day_result = await ctx.session.execute(
        select(DaySession).where(
            DaySession.location_id == quote.location_id, DaySession.status == "open"
        )
    )
    day = day_result.scalars().first()
    if day is None:
        raise HTTPException(status_code=409, detail="The shop isn't open at this location.")

    lines_result = await ctx.session.execute(
        select(QuoteLine).where(QuoteLine.quote_id == quote_id)
    )
    quote_lines = list(lines_result.scalars())

    priced: list[_PricedLine] = []
    for ql in quote_lines:
        product = await ctx.session.get(Product, ql.product_id)
        if product is None:
            raise HTTPException(
                status_code=422, detail=f"Product {ql.product_id} no longer exists."
            )
        gross = _round_minor(ql.quantity * product.selling_price_minor)
        tax = _round_minor(Decimal(gross) * VAT_RATES.get(product.tax_class, Decimal("0")))
        priced.append(
            _PricedLine(
                product_id=product.id,
                quantity=ql.quantity,
                unit_price_minor=product.selling_price_minor,
                line_discount_minor=0,
                tax_minor=tax,
                line_total_minor=gross + tax,
                gross_minor=gross,
            )
        )

    await _check_stock(ctx, quote.location_id, priced, allow_negative=False)

    subtotal_minor = sum(line_.gross_minor for line_ in priced)
    tax_minor = sum(line_.tax_minor for line_ in priced)
    total_minor = subtotal_minor + tax_minor

    sale_id = uuid7_str()
    receipt_number = await _next_sequence_number(ctx.session, ctx.business_id)
    sale = Sale(
        id=sale_id,
        business_id=ctx.business_id,
        location_id=quote.location_id,
        day_session_id=day.id,
        customer_id=quote.customer_id,
        cashier_user_id=ctx.user_id,
        subtotal_minor=subtotal_minor,
        discount_minor=0,
        tax_minor=tax_minor,
        total_minor=total_minor,
        status="completed",
        source_event_id="",
    )
    ctx.session.add(sale)
    await ctx.session.flush()

    sale_lines: list[SaleLine] = []
    for line_ in priced:
        sale_line = SaleLine(
            business_id=ctx.business_id,
            sale_id=sale.id,
            product_id=line_.product_id,
            quantity=line_.quantity,
            unit_price_minor=line_.unit_price_minor,
            line_discount_minor=0,
            tax_minor=line_.tax_minor,
            line_total_minor=line_.line_total_minor,
        )
        ctx.session.add(sale_line)
        sale_lines.append(sale_line)

    sale_payment = SalePayment(
        business_id=ctx.business_id, sale_id=sale.id, method="cash", amount_minor=total_minor
    )
    ctx.session.add(sale_payment)
    receipt = Receipt(business_id=ctx.business_id, sale_id=sale.id, receipt_number=receipt_number)
    ctx.session.add(receipt)
    await ctx.session.flush()

    try:
        event = await append_event(
            ctx.session,
            EventEnvelopeInput(
                business_id=ctx.business_id,
                type="SALE_RECORDED",
                payload={
                    "sale_id": sale.id,
                    "customer_id": quote.customer_id,
                    "lines": [
                        {
                            "product_id": line_.product_id,
                            "quantity": str(line_.quantity),
                            "unit_price_minor": line_.unit_price_minor,
                            "line_total_minor": line_.line_total_minor,
                        }
                        for line_ in priced
                    ],
                    "payments": [
                        {"method": "cash", "amount_minor": total_minor, "reference": None}
                    ],
                    "subtotal_minor": subtotal_minor,
                    "discount_minor": 0,
                    "tax_minor": tax_minor,
                    "total_minor": total_minor,
                },
                actor_user_id=ctx.user_id,
                actor_source="api",
                location_id=quote.location_id,
            ),
        )
        quote_converted_event = await append_event(
            ctx.session,
            EventEnvelopeInput(
                business_id=ctx.business_id,
                type="QUOTE_CONVERTED",
                payload={"quote_id": quote.id, "sale_id": sale.id},
                actor_user_id=ctx.user_id,
                actor_source="api",
                location_id=quote.location_id,
            ),
        )
    except EnvelopeValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    sale.source_event_id = event.id
    quote.status = "converted"
    quote.converted_sale_id = sale.id
    _ = quote_converted_event
    await ctx.session.flush()

    out = _sale_out(sale, receipt_number, sale_lines, [sale_payment])
    await complete(ctx.session, claimed_id=claimed_id, status_code=201, body=out.model_dump())
    return out


# --- returns -------------------------------------------------------------------


@router.post("/returns", response_model=ReturnOut, status_code=201)
async def create_return(
    body: ReturnCreateRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(require_capability("return.create")),
) -> ReturnOut:
    """Spec D.4: a return line is either restocked or written off as
    damaged. `RETURN_RECORDED.lines` carries only the restocked subset
    (see projections/product_stock.py's module docstring for why); a
    `STOCK_WRITTEN_OFF` event is appended per damaged line alongside it, in
    the same transaction."""
    raw_body = await request.body()
    fingerprint = fingerprint_request("POST", "/api/v1/sales/returns", ctx.business_id, raw_body)
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint="POST /api/v1/sales/returns",
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
        return ReturnOut(**existing.response_body)

    if body.refund_method not in VALID_PAYMENT_METHODS | {"credit_note"}:
        raise HTTPException(
            status_code=422, detail=f"Unknown refund method {body.refund_method!r}."
        )
    if not body.lines:
        raise HTTPException(status_code=422, detail="A return needs at least one line.")

    sale = await ctx.session.get(Sale, body.sale_id)
    if sale is None:
        raise HTTPException(status_code=404, detail="Sale not found.")

    refund_amount_minor = 0
    return_lines: list[ReturnLine] = []
    restocked_payload_lines: list[dict] = []
    for line in body.lines:
        product = await ctx.session.get(Product, line.product_id)
        if product is None:
            raise HTTPException(status_code=422, detail=f"Unknown product {line.product_id}.")
        quantity = Decimal(line.quantity)
        line_total = _round_minor(quantity * line.unit_price_minor)
        refund_amount_minor += line_total
        return_lines.append(
            ReturnLine(
                business_id=ctx.business_id,
                product_id=line.product_id,
                quantity=quantity,
                unit_price_minor=line.unit_price_minor,
                line_total_minor=line_total,
                restock=line.restock,
            )
        )
        if line.restock:
            restocked_payload_lines.append(
                {
                    "product_id": line.product_id,
                    "quantity": str(quantity),
                    "unit_price_minor": line.unit_price_minor,
                    "line_total_minor": line_total,
                }
            )

    return_row = Return(
        business_id=ctx.business_id,
        location_id=sale.location_id,
        sale_id=sale.id,
        customer_id=sale.customer_id,
        refund_method=body.refund_method,
        refund_amount_minor=refund_amount_minor,
        reason=body.reason,
        created_by_user_id=ctx.user_id,
        source_event_id="",
    )
    ctx.session.add(return_row)
    await ctx.session.flush()
    for line_row in return_lines:
        line_row.return_id = return_row.id
        ctx.session.add(line_row)
    await ctx.session.flush()

    try:
        event = await append_event(
            ctx.session,
            EventEnvelopeInput(
                business_id=ctx.business_id,
                type="RETURN_RECORDED",
                payload={
                    "return_id": return_row.id,
                    "sale_id": sale.id,
                    "lines": restocked_payload_lines,
                    "refund_method": body.refund_method,
                    "refund_amount_minor": refund_amount_minor,
                    "reason": body.reason,
                },
                actor_user_id=ctx.user_id,
                actor_source="api",
                location_id=sale.location_id,
            ),
        )
        for line in body.lines:
            if not line.restock:
                quantity = Decimal(line.quantity)
                await append_event(
                    ctx.session,
                    EventEnvelopeInput(
                        business_id=ctx.business_id,
                        type="STOCK_WRITTEN_OFF",
                        payload={
                            "product_id": line.product_id,
                            "location_id": sale.location_id,
                            "quantity": str(quantity),
                            "reason": f"Damaged return: {body.reason}",
                        },
                        actor_user_id=ctx.user_id,
                        actor_source="api",
                        location_id=sale.location_id,
                    ),
                )
    except EnvelopeValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return_row.source_event_id = event.id
    await ctx.session.flush()

    out = ReturnOut(
        id=return_row.id,
        sale_id=return_row.sale_id,
        refund_method=return_row.refund_method,
        refund_amount_minor=return_row.refund_amount_minor,
        reason=return_row.reason,
    )
    await complete(ctx.session, claimed_id=claimed_id, status_code=201, body=out.model_dump())
    return out
