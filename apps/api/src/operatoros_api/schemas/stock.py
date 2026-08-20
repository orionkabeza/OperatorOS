from __future__ import annotations

from operatoros_api.schemas.common import ApiModel


class StockReceiveRequest(ApiModel):
    product_id: str
    location_id: str
    quantity: str
    unit_cost_minor: int
    reference: str | None = None


class StockAdjustRequest(ApiModel):
    product_id: str
    location_id: str
    quantity_delta: str
    reason: str


class StockIssueRequest(ApiModel):
    product_id: str
    location_id: str
    quantity: str
    reference: str | None = None


class StockMovementOut(ApiModel):
    id: str
    location_id: str
    product_id: str
    movement_type: str
    quantity_delta: str
    running_balance: str
    unit_cost_minor: int | None
    reference_type: str
    reference_id: str | None
    actor_user_id: str | None
    occurred_at: str


class ProductLocationOut(ApiModel):
    product_id: str
    location_id: str
    on_hand: str
    reserved: str
    available: str
    avg_cost_minor: int
