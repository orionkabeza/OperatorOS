"""The Overview (spec D.10.1), plan §3: reads only from the projections
built elsewhere in this phase (`daily_totals`, `money_location_balance`,
`customer_balances`, `product_locations`) -- never a hand-typed summary
figure (spec A.2 "Nothing is a guess").

**Disclosed Phase 1 trims** (later phases' data doesn't exist yet to
compute these honestly, so they are omitted rather than faked):
- No "vs same weekday average" comparison arrow on Today -- that needs
  Analytics' historical machinery (Phase 4).
- "Needs you today" omits MoMo-unmatched (Phase 2 reconciliation) and
  PO-overdue (Phase 3 suppliers) -- both entirely absent this phase.
- "This month" has no gross/net profit or expenses -- expenses don't
  exist until Cash Box (Phase 2), and a defensible gross-profit figure
  needs cost-at-time-of-sale attribution this phase doesn't capture.
- "Top and bottom" shows only top-selling products by revenue -- no
  margin ranking (needs the same cost data) and no dead-stock list (needs
  a "no movement in N days" query against the full stock_movements ledger
  history, deferred for time).
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select

from operatoros_api.api.deps import RequestContext, require_capability
from operatoros_api.models.catalog import ProductLocation
from operatoros_api.models.customers import CustomerBalance
from operatoros_api.models.day_till import DaySession
from operatoros_api.models.projections import (
    DailyTotals,
    MoneyLocationBalance,
    ProductDailyMovement,
)
from operatoros_api.schemas.overview import (
    MoneyPositionOut,
    NeedsYouTodayOut,
    OverviewOut,
    ThisMonthOut,
    TodayOut,
    TopProductOut,
)

router = APIRouter(prefix="/api/v1/overview", tags=["overview"])


@router.get("", response_model=OverviewOut)
async def get_overview(
    location_id: str = Query(...),
    ctx: RequestContext = Depends(require_capability("report.view")),
) -> OverviewOut:
    day_result = await ctx.session.execute(
        select(DaySession)
        .where(DaySession.location_id == location_id)
        .order_by(DaySession.opened_at.desc())
    )
    current_day = day_result.scalars().first()
    business_date = current_day.business_date if current_day else date.today()

    totals_result = await ctx.session.execute(
        select(DailyTotals).where(
            DailyTotals.location_id == location_id, DailyTotals.business_date == business_date
        )
    )
    totals = totals_result.scalar_one_or_none()
    today = TodayOut(
        revenue_minor=totals.revenue_minor if totals else 0,
        discount_minor=totals.discount_minor if totals else 0,
        tax_minor=totals.tax_minor if totals else 0,
        credit_minor=totals.credit_minor if totals else 0,
        by_payment_method=totals.by_payment_method if totals else {},
        transaction_count=totals.transaction_count if totals else 0,
        returns_amount_minor=totals.returns_amount_minor if totals else 0,
    )

    balances_result = await ctx.session.execute(
        select(MoneyLocationBalance).where(MoneyLocationBalance.location_id == location_id)
    )
    balances_by_account = {row.account_key: row.balance_minor for row in balances_result.scalars()}

    customer_balances_result = await ctx.session.execute(
        select(CustomerBalance).where(CustomerBalance.business_id == ctx.business_id)
    )
    customer_balances = list(customer_balances_result.scalars())
    owed_to_you_minor = sum(c.balance_minor for c in customer_balances if c.balance_minor > 0)

    overdue = [
        c for c in customer_balances if c.balance_minor > 0 and c.oldest_unpaid_at is not None
    ]
    money_position = MoneyPositionOut(
        balances_by_account=balances_by_account,
        owed_to_you_minor=owed_to_you_minor,
        owed_by_you_minor=0,  # supplier payables: Phase 3 (Suppliers) -- not tracked yet.
        working_capital_minor=owed_to_you_minor,
    )

    stock_result = await ctx.session.execute(
        select(ProductLocation).where(ProductLocation.location_id == location_id)
    )
    stock_rows = list(stock_result.scalars())
    out_of_stock = sum(1 for r in stock_rows if r.on_hand <= 0)
    negative_stock = sum(1 for r in stock_rows if r.on_hand < 0)

    needs_you_today = NeedsYouTodayOut(
        customers_overdue_count=len(overdue),
        customers_overdue_amount_minor=sum(c.balance_minor for c in overdue),
        products_out_of_stock=out_of_stock,
        products_negative_stock=negative_stock,
    )

    month_start = business_date.replace(day=1)
    month_totals_result = await ctx.session.execute(
        select(DailyTotals).where(
            DailyTotals.location_id == location_id,
            DailyTotals.business_date >= month_start,
            DailyTotals.business_date <= business_date,
        )
    )
    month_rows = list(month_totals_result.scalars())
    this_month = ThisMonthOut(
        revenue_minor=sum(r.revenue_minor for r in month_rows),
        discount_minor=sum(r.discount_minor for r in month_rows),
        tax_minor=sum(r.tax_minor for r in month_rows),
        transaction_count=sum(r.transaction_count for r in month_rows),
    )

    movement_result = await ctx.session.execute(
        select(ProductDailyMovement).where(
            ProductDailyMovement.location_id == location_id,
            ProductDailyMovement.business_date >= month_start,
            ProductDailyMovement.business_date <= business_date,
        )
    )
    # One row per (business_date, product_id) -- sum across the month's days.
    by_product: dict[str, list] = {}
    for row in movement_result.scalars():
        entry = by_product.setdefault(row.product_id, [Decimal("0"), 0])
        entry[0] += row.quantity_sold
        entry[1] += row.revenue_minor
    top_products = sorted(
        (
            TopProductOut(product_id=pid, quantity_sold=str(qty), revenue_minor=rev)
            for pid, (qty, rev) in by_product.items()
        ),
        key=lambda p: p.revenue_minor,
        reverse=True,
    )[:5]

    return OverviewOut(
        today=today,
        needs_you_today=needs_you_today,
        money_position=money_position,
        this_month=this_month,
        top_products=top_products,
    )
