from __future__ import annotations

from operatoros_api.schemas.common import ApiModel


class ExpenseCreateRequest(ApiModel):
    location_id: str
    amount_minor: int
    category: str
    money_location: str
    payee: str | None = None
    expense_date: str  # YYYY-MM-DD
    note: str | None = None
    receipt_photo_url: str | None = None


class ExpenseOut(ApiModel):
    id: str
    location_id: str
    amount_minor: int
    category: str
    money_location: str
    payee: str | None
    expense_date: str
    note: str | None
    receipt_photo_url: str | None
    ocr_status: str
    status: str
    created_by_user_id: str
    approved_by_user_id: str | None
    approved_at: str | None
    rejected_reason: str | None


class ExpenseRejectRequest(ApiModel):
    reason: str


class ReceiptUploadOut(ApiModel):
    receipt_photo_url: str
    # Always null this phase -- plan §0.6: OCR pre-fill is a documented
    # no-op seam, no OCR provider credentials exist yet.
    ocr_prefill: dict | None = None


class RecurringExpenseCreateRequest(ApiModel):
    location_id: str
    amount_minor: int
    category: str
    money_location: str
    payee: str | None = None
    note: str | None = None
    interval: str  # daily | weekly | monthly
    next_run_date: str  # YYYY-MM-DD


class RecurringExpenseUpdateRequest(ApiModel):
    amount_minor: int | None = None
    category: str | None = None
    money_location: str | None = None
    payee: str | None = None
    note: str | None = None
    interval: str | None = None
    next_run_date: str | None = None
    active: bool | None = None


class RecurringExpenseOut(ApiModel):
    id: str
    location_id: str
    amount_minor: int
    category: str
    money_location: str
    payee: str | None
    note: str | None
    interval: str
    next_run_date: str
    active: bool
