"""Live customer-segment membership computation (spec D.6.8, plan §0.7):
"saved, auto-updating filters... computed live so counts are never
stale." A small, closed vocabulary of filter kinds matching D.6.8's own
named examples (`Bought in the last 30 days`, `Haven't been back in 60
days`, `Top 20 by spend`) rather than a general query builder -- the
`custom` kind is a documented placeholder for a future filter-builder UI,
not implemented this phase (returns an empty set rather than guessing at
a query shape nothing has specified yet).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select

from operatoros_api.models.customers import Customer
from operatoros_api.models.sales import Sale


async def segment_member_ids(session, business_id: str, filter_spec: dict) -> set[str]:
    kind = filter_spec.get("kind")
    now = datetime.now(UTC)

    if kind == "bought_in_last_days":
        since = now - timedelta(days=int(filter_spec["days"]))
        result = await session.execute(
            select(Sale.customer_id)
            .where(
                Sale.business_id == business_id,
                Sale.created_at >= since,
                Sale.customer_id.is_not(None),
            )
            .distinct()
        )
        return {row[0] for row in result.all()}

    if kind == "inactive_since_days":
        cutoff = now - timedelta(days=int(filter_spec["days"]))
        last_sale_result = await session.execute(
            select(Sale.customer_id, func.max(Sale.created_at))
            .where(Sale.business_id == business_id, Sale.customer_id.is_not(None))
            .group_by(Sale.customer_id)
        )
        last_sale_by_customer = dict(last_sale_result.all())
        all_customers_result = await session.execute(
            select(Customer.id).where(Customer.business_id == business_id)
        )
        never_bought_epoch = datetime.min.replace(tzinfo=UTC)
        return {
            row[0]
            for row in all_customers_result.all()
            if last_sale_by_customer.get(row[0], never_bought_epoch) < cutoff
        }

    if kind == "top_n_by_spend":
        result = await session.execute(
            select(Sale.customer_id, func.sum(Sale.total_minor))
            .where(Sale.business_id == business_id, Sale.customer_id.is_not(None))
            .group_by(Sale.customer_id)
            .order_by(func.sum(Sale.total_minor).desc())
            .limit(int(filter_spec["n"]))
        )
        return {row[0] for row in result.all()}

    return set()
