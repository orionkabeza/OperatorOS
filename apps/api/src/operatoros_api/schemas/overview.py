from __future__ import annotations

from operatoros_api.schemas.common import ApiModel


class TodayOut(ApiModel):
    revenue_minor: int
    discount_minor: int
    tax_minor: int
    credit_minor: int
    by_payment_method: dict[str, int]
    transaction_count: int
    returns_amount_minor: int


class NeedsYouTodayOut(ApiModel):
    customers_overdue_count: int
    customers_overdue_amount_minor: int
    products_out_of_stock: int
    products_negative_stock: int


class MoneyPositionOut(ApiModel):
    balances_by_account: dict[str, int]
    owed_to_you_minor: int
    owed_by_you_minor: int
    working_capital_minor: int


class ThisMonthOut(ApiModel):
    revenue_minor: int
    discount_minor: int
    tax_minor: int
    transaction_count: int


class TopProductOut(ApiModel):
    product_id: str
    quantity_sold: str
    revenue_minor: int


class OverviewOut(ApiModel):
    today: TodayOut
    needs_you_today: NeedsYouTodayOut
    money_position: MoneyPositionOut
    this_month: ThisMonthOut
    top_products: list[TopProductOut]
