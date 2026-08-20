from __future__ import annotations

from operatoros_api.schemas.common import ApiModel


class PayLinkCreateRequest(ApiModel):
    location_id: str
    amount_minor: int | None = None  # defaults to the customer's full balance
    expires_in_days: int = 7


class PayLinkCreateOut(ApiModel):
    token: str
    amount_minor: int
    expires_at: str


class PayLinkPageOut(ApiModel):
    business_name: str
    customer_name: str
    amount_minor: int
    status: str
    expires_at: str


class PayLinkRequestPaymentRequest(ApiModel):
    phone: str


class PayLinkRequestPaymentOut(ApiModel):
    status: str
    external_id: str


class PayLinkStatusOut(ApiModel):
    status: str
    paid_at: str | None
