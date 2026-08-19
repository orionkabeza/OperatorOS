from __future__ import annotations

from datetime import datetime

from operatoros_api.schemas.common import ApiModel


class EventAppendRequest(ApiModel):
    type: str
    payload: dict
    location_id: str | None = None
    occurred_at: datetime | None = None
    correlation_id: str | None = None
    reverses_event_id: str | None = None
    corrects_event_id: str | None = None


class EventOut(ApiModel):
    id: str
    type: str
    business_id: str
    location_id: str | None
    occurred_at: datetime
    recorded_at: datetime
    correlation_id: str
    schema_version: int


class MoneyLocationBalanceOut(ApiModel):
    location_id: str
    account_key: str
    balance_minor: int
    currency: str
