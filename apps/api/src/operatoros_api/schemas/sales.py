from __future__ import annotations

from operatoros_api.schemas.common import ApiModel


class SaleLineRequest(ApiModel):
    product_id: str
    quantity: str
    unit_price_minor: int | None = None
    line_discount_minor: int = 0


class SalePaymentRequest(ApiModel):
    method: str
    amount_minor: int
    reference: str | None = None


class SaleCreateRequest(ApiModel):
    location_id: str
    customer_id: str | None = None
    lines: list[SaleLineRequest]
    discount_minor: int = 0
    payments: list[SalePaymentRequest]
    allow_negative_stock: bool = False
    manager_override_user_id: str | None = None
    manager_override_pin: str | None = None
    override_reason: str | None = None


class SaleLineOut(ApiModel):
    product_id: str
    quantity: str
    unit_price_minor: int
    line_discount_minor: int
    tax_minor: int
    line_total_minor: int


class SalePaymentOut(ApiModel):
    method: str
    amount_minor: int
    reference: str | None


class SaleOut(ApiModel):
    id: str
    location_id: str
    customer_id: str | None
    receipt_number: int
    subtotal_minor: int
    discount_minor: int
    tax_minor: int
    total_minor: int
    status: str
    lines: list[SaleLineOut]
    payments: list[SalePaymentOut]


class QuoteLineRequest(ApiModel):
    product_id: str
    quantity: str
    unit_price_minor: int


class QuoteCreateRequest(ApiModel):
    location_id: str
    customer_id: str | None = None
    lines: list[QuoteLineRequest]
    discount_minor: int = 0
    expires_in_days: int = 14


class QuoteLineOut(ApiModel):
    product_id: str
    quantity: str
    unit_price_minor: int
    line_total_minor: int


class QuoteOut(ApiModel):
    id: str
    quote_number: int
    location_id: str
    customer_id: str | None
    subtotal_minor: int
    discount_minor: int
    tax_minor: int
    total_minor: int
    status: str
    expires_at: str
    lines: list[QuoteLineOut] = []


class ReturnLineRequest(ApiModel):
    product_id: str
    quantity: str
    unit_price_minor: int
    restock: bool
    condition: str = "good"


class ReturnCreateRequest(ApiModel):
    sale_id: str
    lines: list[ReturnLineRequest]
    refund_method: str
    reason: str


class ReturnOut(ApiModel):
    id: str
    sale_id: str
    refund_method: str
    refund_amount_minor: int
    reason: str
