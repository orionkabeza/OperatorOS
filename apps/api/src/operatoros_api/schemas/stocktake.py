from __future__ import annotations

from operatoros_api.schemas.common import ApiModel


class StocktakeStartRequest(ApiModel):
    location_id: str
    scope: str
    category_id: str | None = None
    product_ids: list[str] | None = None
    freeze_during_count: bool = False


class StocktakeLineOut(ApiModel):
    id: str
    product_id: str
    expected_quantity: str
    counted_quantity: str | None
    counted_by_user_id: str | None
    counted_at: str | None
    variance_qty: str | None
    variance_value_minor: int | None
    reason: str | None


class StocktakeOut(ApiModel):
    id: str
    location_id: str
    scope: str
    status: str
    freeze_during_count: bool
    started_at: str
    posted_at: str | None
    variance_value_minor: int | None
    line_count: int | None
    progress_counted: int
    progress_total: int
    lines: list[StocktakeLineOut] = []


class StocktakeCountRequest(ApiModel):
    counted_quantity: str


class StocktakeLineReasonRequest(ApiModel):
    reason: str
