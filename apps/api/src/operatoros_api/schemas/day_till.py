from __future__ import annotations

from operatoros_api.schemas.common import ApiModel


class DayOpenRequest(ApiModel):
    location_id: str
    counted_amount_minor: int
    variance_reason: str | None = None


class DayCloseRequest(ApiModel):
    location_id: str
    counted_amount_minor: int
    variance_reason: str | None = None


class DaySessionOut(ApiModel):
    id: str
    location_id: str
    business_date: str
    status: str
    opened_at: str
    opening_counted_amount_minor: int
    opening_expected_amount_minor: int
    opening_variance_minor: int
    closed_at: str | None
    closing_counted_amount_minor: int | None
    closing_expected_amount_minor: int | None
    closing_variance_minor: int | None
    transaction_count: int


class TillOpenRequest(ApiModel):
    location_id: str
    opening_float_minor: int


class TillCloseRequest(ApiModel):
    counted_amount_minor: int


class TillSessionOut(ApiModel):
    id: str
    location_id: str
    day_session_id: str
    cashier_user_id: str
    status: str
    opened_at: str
    opening_float_minor: int
    closed_at: str | None
    closing_counted_amount_minor: int | None
    closing_expected_amount_minor: int | None
    closing_variance_minor: int | None
