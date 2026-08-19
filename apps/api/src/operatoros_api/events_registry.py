"""The typed event registry (spec E.2).

One Pydantic v2 payload model per event type in the initial set, all
`extra="forbid"` so a typo'd or unexpected field is rejected rather than
silently dropped or silently stored. Each model carries `SCHEMA_VERSION`
as a class attribute; `append_event` (events/append.py) stamps that onto
the envelope's `schema_version` column.

Only `MONEY_TRANSFERRED` and `EXPENSE_RECORDED` have a wired projection
handler in Phase 0 (they drive `money_location_balance` — see
projections/money_location_balance.py) — every other type here validates
and appends correctly today, but nothing projects it yet. That's expected:
"No feature writes state except through append" (approved plan §3); the
per-feature handlers land with each feature's own phase.
"""

from __future__ import annotations

from typing import ClassVar

from pydantic import BaseModel, ConfigDict


class EventPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # ClassVar, not a model field: it must not appear in model_dump() (it
    # would otherwise be double-stored, once here and once in the events
    # envelope's own `schema_version` column) and must not be settable by
    # request input.
    SCHEMA_VERSION: ClassVar[int] = 1


# --- Day / till -------------------------------------------------------

class DayOpenedPayload(EventPayload):
    counted_amount_minor: int
    expected_amount_minor: int
    variance_minor: int
    variance_reason: str | None = None


class DayClosedPayload(EventPayload):
    counted_amount_minor: int
    expected_amount_minor: int
    variance_minor: int
    variance_reason: str | None = None
    transaction_count: int


class TillSessionOpenedPayload(EventPayload):
    till_session_id: str
    opening_float_minor: int
    cashier_user_id: str


class TillSessionClosedPayload(EventPayload):
    till_session_id: str
    counted_amount_minor: int
    expected_amount_minor: int
    variance_minor: int


# --- Sales / quotes / returns ------------------------------------------

class SaleLineInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: str
    quantity: str  # NUMERIC(18,4) transported as a decimal string
    unit_price_minor: int
    line_total_minor: int


class SalePaymentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    method: str
    amount_minor: int
    reference: str | None = None


class SaleRecordedPayload(EventPayload):
    sale_id: str
    customer_id: str | None = None
    lines: list[SaleLineInput]
    payments: list[SalePaymentInput]
    subtotal_minor: int
    discount_minor: int
    tax_minor: int
    total_minor: int


class SaleReversedPayload(EventPayload):
    sale_id: str
    reason: str


class QuoteIssuedPayload(EventPayload):
    quote_id: str
    customer_id: str | None = None
    total_minor: int
    expires_at: str


class QuoteConvertedPayload(EventPayload):
    quote_id: str
    sale_id: str


class ReturnRecordedPayload(EventPayload):
    return_id: str
    sale_id: str
    lines: list[SaleLineInput]
    refund_method: str
    refund_amount_minor: int
    reason: str


# --- Stock ---------------------------------------------------------------

class StockReceivedPayload(EventPayload):
    product_id: str
    location_id: str
    quantity: str
    unit_cost_minor: int
    reference: str | None = None


class StockIssuedPayload(EventPayload):
    product_id: str
    location_id: str
    quantity: str
    reference: str | None = None


class StockAdjustedPayload(EventPayload):
    product_id: str
    location_id: str
    quantity_delta: str
    reason: str


class StockTransferredOutPayload(EventPayload):
    product_id: str
    from_location_id: str
    to_location_id: str
    quantity: str
    transfer_id: str


class StockTransferredInPayload(EventPayload):
    product_id: str
    from_location_id: str
    to_location_id: str
    quantity: str
    transfer_id: str
    discrepancy: bool = False


class StockWrittenOffPayload(EventPayload):
    product_id: str
    location_id: str
    quantity: str
    reason: str


class StocktakePostedPayload(EventPayload):
    stocktake_id: str
    location_id: str
    variance_value_minor: int
    line_count: int


# --- Money ---------------------------------------------------------------

class PaymentReceivedPayload(EventPayload):
    customer_id: str | None = None
    supplier_id: str | None = None
    amount_minor: int
    method: str
    money_location: str
    reference: str | None = None


class PaymentMadePayload(EventPayload):
    supplier_id: str | None = None
    amount_minor: int
    method: str
    money_location: str
    reference: str | None = None


class ExpenseRecordedPayload(EventPayload):
    amount_minor: int
    category: str
    money_location: str
    payee: str | None = None
    note: str | None = None


class MoneyTransferredPayload(EventPayload):
    from_money_location: str
    to_money_location: str
    amount_minor: int
    note: str | None = None


class MomoTransactionMatchedPayload(EventPayload):
    momo_transaction_id: str
    matched_to_type: str
    matched_to_id: str
    amount_minor: int


# --- Customers / debt ------------------------------------------------------

class CustomerCreatedPayload(EventPayload):
    customer_id: str
    name: str
    phone_hash: str | None = None


class CreditLimitChangedPayload(EventPayload):
    customer_id: str
    old_limit_minor: int
    new_limit_minor: int
    reason: str | None = None


class DebtWrittenOffPayload(EventPayload):
    customer_id: str
    amount_minor: int
    reason: str


class ReminderSentPayload(EventPayload):
    customer_id: str
    channel: str
    template_key: str
    amount_minor: int


# --- Suppliers -------------------------------------------------------------

class PoCreatedPayload(EventPayload):
    po_id: str
    supplier_id: str
    total_minor: int


class PoSentPayload(EventPayload):
    po_id: str
    channel: str


class GoodsReceivedPayload(EventPayload):
    po_id: str | None = None
    supplier_id: str
    lines: list[StockReceivedPayload]


class SupplierInvoiceRecordedPayload(EventPayload):
    supplier_id: str
    invoice_id: str
    amount_minor: int
    due_date: str


# --- Products ----------------------------------------------------------

class PriceChangedPayload(EventPayload):
    product_id: str
    old_price_minor: int
    new_price_minor: int


class ProductCreatedPayload(EventPayload):
    product_id: str
    name: str
    sku: str | None = None


class ProductArchivedPayload(EventPayload):
    product_id: str
    reason: str | None = None


# --- Users / audit-adjacent ---------------------------------------------

class UserInvitedPayload(EventPayload):
    invited_user_id: str
    role_key: str


class RoleChangedPayload(EventPayload):
    target_user_id: str
    old_role_key: str
    new_role_key: str


class PermissionOverriddenPayload(EventPayload):
    target_user_id: str
    permission_key: str
    effect: str
    location_id: str | None = None


class DataExportedPayload(EventPayload):
    export_type: str
    row_count: int


class LoginSucceededPayload(EventPayload):
    user_id: str
    device_id: str


class LoginFailedPayload(EventPayload):
    identifier_hash: str
    reason: str


EVENT_REGISTRY: dict[str, type[EventPayload]] = {
    "DAY_OPENED": DayOpenedPayload,
    "DAY_CLOSED": DayClosedPayload,
    "TILL_SESSION_OPENED": TillSessionOpenedPayload,
    "TILL_SESSION_CLOSED": TillSessionClosedPayload,
    "SALE_RECORDED": SaleRecordedPayload,
    "SALE_REVERSED": SaleReversedPayload,
    "QUOTE_ISSUED": QuoteIssuedPayload,
    "QUOTE_CONVERTED": QuoteConvertedPayload,
    "RETURN_RECORDED": ReturnRecordedPayload,
    "STOCK_RECEIVED": StockReceivedPayload,
    "STOCK_ISSUED": StockIssuedPayload,
    "STOCK_ADJUSTED": StockAdjustedPayload,
    "STOCK_TRANSFERRED_OUT": StockTransferredOutPayload,
    "STOCK_TRANSFERRED_IN": StockTransferredInPayload,
    "STOCK_WRITTEN_OFF": StockWrittenOffPayload,
    "STOCKTAKE_POSTED": StocktakePostedPayload,
    "PAYMENT_RECEIVED": PaymentReceivedPayload,
    "PAYMENT_MADE": PaymentMadePayload,
    "EXPENSE_RECORDED": ExpenseRecordedPayload,
    "MONEY_TRANSFERRED": MoneyTransferredPayload,
    "MOMO_TRANSACTION_MATCHED": MomoTransactionMatchedPayload,
    "CUSTOMER_CREATED": CustomerCreatedPayload,
    "CREDIT_LIMIT_CHANGED": CreditLimitChangedPayload,
    "DEBT_WRITTEN_OFF": DebtWrittenOffPayload,
    "REMINDER_SENT": ReminderSentPayload,
    "PO_CREATED": PoCreatedPayload,
    "PO_SENT": PoSentPayload,
    "GOODS_RECEIVED": GoodsReceivedPayload,
    "SUPPLIER_INVOICE_RECORDED": SupplierInvoiceRecordedPayload,
    "PRICE_CHANGED": PriceChangedPayload,
    "PRODUCT_CREATED": ProductCreatedPayload,
    "PRODUCT_ARCHIVED": ProductArchivedPayload,
    "USER_INVITED": UserInvitedPayload,
    "ROLE_CHANGED": RoleChangedPayload,
    "PERMISSION_OVERRIDDEN": PermissionOverriddenPayload,
    "DATA_EXPORTED": DataExportedPayload,
    "LOGIN_SUCCEEDED": LoginSucceededPayload,
    "LOGIN_FAILED": LoginFailedPayload,
}


def get_payload_model(event_type: str) -> type[EventPayload]:
    try:
        return EVENT_REGISTRY[event_type]
    except KeyError as exc:
        raise ValueError(f"Unknown event type: {event_type!r}") from exc
