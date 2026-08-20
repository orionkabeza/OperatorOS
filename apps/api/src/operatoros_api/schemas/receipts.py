from __future__ import annotations

from operatoros_api.schemas.common import ApiModel


class ReceiptOut(ApiModel):
    receipt_number: int
    sale_id: str
    subtotal_minor: int
    discount_minor: int
    tax_minor: int
    total_minor: int
    lines: list[dict]
    payments: list[dict]
    rendered_text: str
