from __future__ import annotations

from operatoros_api.schemas.common import ApiModel


class MomoTransactionOut(ApiModel):
    id: str
    provider: str
    external_id: str
    phone: str
    amount_minor: int
    direction: str
    occurred_at: str
    status: str
    matched_to_type: str | None
    matched_to_id: str | None


class MomoMatchSuggestionOut(ApiModel):
    transaction_id: str
    customer_id: str
    customer_name: str
    sale_id: str | None
    confidence: str  # high | medium | low
    reason: str


class MomoMatchRequest(ApiModel):
    matched_to_type: str  # invoice | debt_payment | other_income | not_ours
    location_id: str | None = None
    customer_id: str | None = None
    sale_id: str | None = None


class MomoMatchOut(ApiModel):
    transaction_id: str
    status: str
    payment_event_id: str | None


class MomoConnectRequest(ApiModel):
    merchant_ref: str | None = None


class MomoConnectOut(ApiModel):
    provider: str
    status: str
    connected_at: str | None


class MomoImportResultOut(ApiModel):
    imported: int
    skipped_duplicates: int
