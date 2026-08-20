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
