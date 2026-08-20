from __future__ import annotations

from operatoros_api.schemas.common import ApiModel


class AgeingBucketOut(ApiModel):
    bucket: str
    amount_minor: int


class DebtHeaderOut(ApiModel):
    owed_to_you_minor: int
    overdue_minor: int
    due_this_week_minor: int
    collected_this_month_minor: int
    ageing: list[AgeingBucketOut]


class CustomerAccountOut(ApiModel):
    id: str
    name: str
    phone: str | None
    balance_minor: int
    oldest_unpaid_days: int | None
    credit_limit_minor: int
    limit_used_percent: int
    last_payment_at: str | None
    last_contacted_at: str | None
    status: str  # current | due_soon | overdue | on_hold | written_off


class InvoiceOut(ApiModel):
    sale_id: str
    occurred_at: str
    due_date_at: str | None
    total_minor: int
    paid_minor: int
    remaining_minor: int
    days_overdue: int
    bucket: str


class StatementLineOut(ApiModel):
    occurred_at: str
    type: str  # sale | payment | write_off
    description: str
    amount_minor: int  # positive = increases debt, negative = decreases it
    running_balance_minor: int
    reference_id: str


class ContactHistoryEntryOut(ApiModel):
    id: str
    sent_at: str
    source: str
    channel: str
    template_key: str | None
    delivered_status: str
    read_status: str
    note: str | None
    promise_to_pay_date: str | None


class LogCallRequest(ApiModel):
    note: str
    promise_to_pay_date: str | None = None


class ManualAllocationLine(ApiModel):
    sale_id: str
    amount_minor: int


class TakePaymentRequest(ApiModel):
    location_id: str
    amount_minor: int
    method: str  # cash | momo | airtel | bank | cheque
    reference: str | None = None
    allocation_mode: str = "auto"  # auto | manual
    manual_allocations: list[ManualAllocationLine] | None = None
    received_at: str | None = None  # back-dating, permission-gated
    back_date_reason: str | None = None
    send_receipt: bool = False


class AllocationOut(ApiModel):
    sale_id: str
    amount_minor: int


class TakePaymentOut(ApiModel):
    payment_event_id: str
    customer_id: str
    amount_minor: int
    allocations: list[AllocationOut]
    customer_balance_minor: int


class WriteOffRequest(ApiModel):
    reason: str
    confirm_customer_name: str | None = None


class WriteOffOut(ApiModel):
    customer_id: str
    amount_written_off_minor: int
    written_off_at: str


class ChaseQueueEntryOut(ApiModel):
    customer_id: str
    name: str
    phone: str | None
    balance_minor: int
    days_overdue: int
    score: int
