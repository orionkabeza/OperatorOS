from __future__ import annotations

from operatoros_api.schemas.common import ApiModel


class TransferLineRequest(ApiModel):
    product_id: str
    quantity: str


class TransferCreateRequest(ApiModel):
    from_location_id: str
    to_location_id: str
    lines: list[TransferLineRequest]


class TransferReceiveLineRequest(ApiModel):
    product_id: str
    quantity_received: str


class TransferReceiveRequest(ApiModel):
    lines: list[TransferReceiveLineRequest]


class TransferLineOut(ApiModel):
    product_id: str
    quantity_sent: str
    quantity_received: str | None
    discrepancy: bool


class TransferOut(ApiModel):
    id: str
    from_location_id: str
    to_location_id: str
    status: str
    sent_at: str
    received_at: str | None
    lines: list[TransferLineOut] = []
