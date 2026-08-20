from __future__ import annotations

from operatoros_api.schemas.common import ApiModel


class BalanceCardOut(ApiModel):
    location_id: str
    account_key: str
    display_name: str
    masked_account_number: str | None
    kind: str
    connection_status: str  # manual | connected
    last_synced_at: str | None
    balance_minor: int
    today_movement_minor: int


class MoneyMovementOut(ApiModel):
    occurred_at: str
    type: str
    description: str
    location_id: str
    account_key: str
    in_minor: int
    out_minor: int
    user_id: str | None
    reference: str | None


class MoneyLocationCreate(ApiModel):
    location_id: str
    account_key: str
    display_name: str
    masked_account_number: str | None = None
    kind: str


class MoneyLocationOut(ApiModel):
    id: str
    location_id: str
    account_key: str
    display_name: str
    masked_account_number: str | None
    kind: str
    connection_status: str
    last_synced_at: str | None


class UpdateBalanceRequest(ApiModel):
    new_balance_minor: int
    note: str | None = None
