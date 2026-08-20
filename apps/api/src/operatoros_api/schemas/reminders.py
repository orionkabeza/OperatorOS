from __future__ import annotations

from operatoros_api.schemas.common import ApiModel


class ReminderStepIn(ApiModel):
    step_order: int
    offset_days: int
    label: str
    channel: str = "whatsapp"
    template_key: str
    templates: dict[str, str]  # {language_code: body}


class ReminderStepOut(ApiModel):
    id: str
    step_order: int
    offset_days: int
    label: str
    channel: str
    template_key: str
    templates: dict[str, str]


class ReminderScheduleCreateRequest(ApiModel):
    name: str
    customer_id: str | None = None  # None = the business default
    paused: bool = False
    approval_mode: bool = False
    quiet_hours_start: int = 20
    quiet_hours_end: int = 7
    max_per_customer_hours: int = 48
    steps: list[ReminderStepIn] = []


class ReminderScheduleUpdateRequest(ApiModel):
    name: str | None = None
    paused: bool | None = None
    approval_mode: bool | None = None
    quiet_hours_start: int | None = None
    quiet_hours_end: int | None = None
    max_per_customer_hours: int | None = None


class ReminderScheduleOut(ApiModel):
    id: str
    name: str
    customer_id: str | None
    paused: bool
    approval_mode: bool
    quiet_hours_start: int
    quiet_hours_end: int
    max_per_customer_hours: int
    steps: list[ReminderStepOut]


class ReminderPreviewRequest(ApiModel):
    customer_id: str
    template: str
    language: str = "en"


class ReminderPreviewOut(ApiModel):
    rendered: str


class ReminderDigestEntryOut(ApiModel):
    customer_id: str
    customer_name: str
    step_id: str
    step_order: int
    label: str
    channel: str
    template_key: str
    sale_id: str
    amount_minor: int
    days_overdue: int


class ReminderDigestSendRequest(ApiModel):
    # Empty list = send every currently-queued entry; otherwise only the
    # named (customer_id, step_id) pairs -- the digest's "tick boxes" (D.6.5).
    customer_ids: list[str] = []
