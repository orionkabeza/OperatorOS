from __future__ import annotations

from operatoros_api.schemas.common import ApiModel


class CustomerCreate(ApiModel):
    name: str
    phone: str | None = None
    credit_limit_minor: int = 0
    terms_days: int = 0
    language: str = "en"


class CustomerUpdate(ApiModel):
    name: str | None = None
    phone: str | None = None
    terms_days: int | None = None
    language: str | None = None
    status: str | None = None


class CreditLimitChangeRequest(ApiModel):
    new_limit_minor: int
    reason: str | None = None


class CustomerOut(ApiModel):
    id: str
    name: str
    phone: str | None
    terms_days: int
    language: str
    status: str
    credit_limit_minor: int
    balance_minor: int
    limit_used_percent: int
    oldest_unpaid_at: str | None


class SegmentCreateRequest(ApiModel):
    name: str
    filter_spec: dict


class SegmentOut(ApiModel):
    id: str
    name: str
    filter_spec: dict
    member_count: int


class BroadcastSendRequest(ApiModel):
    segment_id: str
    message: str
    image_url: str | None = None
    link_url: str | None = None


class BroadcastSendOut(ApiModel):
    id: str
    segment_id: str | None
    message: str
    sent_at: str
    recipient_count: int
    delivered_count: int
    read_count: int
