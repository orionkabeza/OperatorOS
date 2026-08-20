"""Receipts (spec D.4 "Receipt options", plan §0.4/§3).

Real receipt data model and rendering (a printable HTML/plain-text
representation, generated on demand, never stored as a binary blob so it
always reflects the current business/receipt template). `Send on
WhatsApp`/`Send by SMS` go through the stubbed `NotificationSender`
(notifications.py) -- see that module's docstring. **Known gap, disclosed
rather than silently skipped:** a true binary PDF download is NOT
implemented this phase (no PDF-rendering dependency was added, given the
size of the rest of Phase 1's scope) -- `GET /{receipt_number}` returns a
`rendered_text` HTML string instead, which covers the spec's "printable"
requirement (a browser can print an HTML view) but not "download as a
.pdf file". See docs/DECISIONS.md.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select

from operatoros_api.api.deps import (
    RequestContext,
    get_current_context,
    idempotency_key_header,
)
from operatoros_api.idempotency_service import (
    claim_or_replay,
    complete,
    fingerprint_request,
    get_existing,
)
from operatoros_api.models.customers import Customer
from operatoros_api.models.sales import Receipt, Sale, SaleLine, SalePayment
from operatoros_api.notifications import get_notification_sender
from operatoros_api.schemas.common import ApiModel
from operatoros_api.schemas.receipts import ReceiptOut

router = APIRouter(prefix="/api/v1/receipts", tags=["receipts"])


class SendReceiptRequest(ApiModel):
    channel: str


def _render_text(
    sale: Sale, receipt_number: int, lines: list[SaleLine], payments: list[SalePayment]
) -> str:
    out_lines = [
        f"Receipt #{receipt_number}",
        "-" * 24,
    ]
    for line in lines:
        out_lines.append(f"{line.quantity} x {line.product_id}  {line.line_total_minor}")
    out_lines.append("-" * 24)
    out_lines.append(f"Subtotal: {sale.subtotal_minor}")
    out_lines.append(f"Discount: {sale.discount_minor}")
    out_lines.append(f"Tax: {sale.tax_minor}")
    out_lines.append(f"TOTAL: {sale.total_minor}")
    for pay in payments:
        out_lines.append(f"Paid ({pay.method}): {pay.amount_minor}")
    return "\n".join(out_lines)


async def _load_receipt(ctx: RequestContext, receipt_number: int) -> ReceiptOut:
    result = await ctx.session.execute(
        select(Receipt).where(Receipt.receipt_number == receipt_number)
    )
    receipt = result.scalar_one_or_none()
    if receipt is None:
        raise HTTPException(status_code=404, detail="Not found.")
    sale = await ctx.session.get(Sale, receipt.sale_id)
    if sale is None:
        raise HTTPException(status_code=404, detail="Not found.")
    lines_result = await ctx.session.execute(select(SaleLine).where(SaleLine.sale_id == sale.id))
    lines = list(lines_result.scalars())
    payments_result = await ctx.session.execute(
        select(SalePayment).where(SalePayment.sale_id == sale.id)
    )
    payments = list(payments_result.scalars())

    return ReceiptOut(
        receipt_number=receipt.receipt_number,
        sale_id=sale.id,
        subtotal_minor=sale.subtotal_minor,
        discount_minor=sale.discount_minor,
        tax_minor=sale.tax_minor,
        total_minor=sale.total_minor,
        lines=[
            {
                "product_id": line_.product_id,
                "quantity": str(line_.quantity),
                "unit_price_minor": line_.unit_price_minor,
                "line_total_minor": line_.line_total_minor,
            }
            for line_ in lines
        ],
        payments=[
            {"method": p.method, "amount_minor": p.amount_minor, "reference": p.reference}
            for p in payments
        ],
        rendered_text=_render_text(sale, receipt.receipt_number, lines, payments),
    )


@router.get("/{receipt_number}", response_model=ReceiptOut)
async def get_receipt(
    receipt_number: int, ctx: RequestContext = Depends(get_current_context)
) -> ReceiptOut:
    return await _load_receipt(ctx, receipt_number)


@router.post("/{receipt_number}/send", status_code=200)
async def send_receipt(
    receipt_number: int,
    body: SendReceiptRequest,
    request: Request,
    idempotency_key: str = Depends(idempotency_key_header),
    ctx: RequestContext = Depends(get_current_context),
) -> dict:
    raw_body = await request.body()
    fingerprint = fingerprint_request(
        "POST", f"/api/v1/receipts/{receipt_number}/send", ctx.business_id, raw_body
    )
    claimed_id = await claim_or_replay(
        ctx.session,
        business_id=ctx.business_id,
        key=idempotency_key,
        endpoint=f"POST /api/v1/receipts/{receipt_number}/send",
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
        return existing.response_body

    receipt_out = await _load_receipt(ctx, receipt_number)
    to = "unknown"
    if body.channel in ("whatsapp", "sms"):
        result = await ctx.session.execute(
            select(Receipt).where(Receipt.receipt_number == receipt_number)
        )
        receipt = result.scalar_one()
        sale = await ctx.session.get(Sale, receipt.sale_id)
        if sale and sale.customer_id:
            customer = await ctx.session.get(Customer, sale.customer_id)
            to = customer.phone if customer and customer.phone else "unknown"

    sender = get_notification_sender()
    message_id = await sender.send(
        channel=body.channel,
        to=to,
        subject=f"Receipt #{receipt_number}",
        body=receipt_out.rendered_text,
    )

    result_result = await ctx.session.execute(
        select(Receipt).where(Receipt.receipt_number == receipt_number)
    )
    receipt_row = result_result.scalar_one()
    receipt_row.send_channel = body.channel
    receipt_row.sent_at = datetime.now(UTC)
    await ctx.session.flush()

    body_out = {"message_id": message_id, "channel": body.channel}
    await complete(ctx.session, claimed_id=claimed_id, status_code=200, body=body_out)
    return body_out
