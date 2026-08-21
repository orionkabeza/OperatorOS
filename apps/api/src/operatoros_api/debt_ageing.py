"""Shared "open invoice" / ageing computation (plan §0.2), factored out of
`api/routers/debt.py` so `api/routers/momo.py` (MoMo settlement allocating
against open invoices, D.7.3) and `api/routers/pay.py` (pay-link
settlement, D.6.5) use the EXACT same allocation logic `take-payment`
does, not a second hand-rolled copy that could quietly drift from it.

A credit sale IS the invoice (plan §0.2) -- "open invoices" always means
"credit-method `sale_payments` lines on a `Sale` whose
`total_minor - Σ payment_allocations.amount_minor` is still > 0."
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, select

from operatoros_api.models.payments import PaymentAllocation
from operatoros_api.models.sales import Sale, SalePayment


@dataclass
class OpenInvoice:
    sale_id: str
    customer_id: str
    occurred_at: datetime
    due_date_at: datetime | None
    total_minor: int
    allocated_minor: int
    remaining_minor: int


def days_overdue(due_date_at: datetime | None, now: datetime) -> int:
    if due_date_at is None:
        return 0
    delta = now.date() - due_date_at.date()
    return max(delta.days, 0)


def ageing_bucket(overdue_days: int) -> str:
    if overdue_days <= 0:
        return "current"
    if overdue_days <= 30:
        return "1-30"
    if overdue_days <= 60:
        return "31-60"
    if overdue_days <= 90:
        return "61-90"
    return "90+"


def _build_open_invoices(sale_rows: list, allocated_by_sale: dict[str, int]) -> list[OpenInvoice]:
    invoices: list[OpenInvoice] = []
    for sale_id, customer_id, occurred_at, due_date_at, total_minor in sale_rows:
        allocated = allocated_by_sale.get(sale_id, 0)
        remaining = int(total_minor) - int(allocated)
        if remaining <= 0:
            continue
        invoices.append(
            OpenInvoice(
                sale_id=sale_id,
                customer_id=customer_id,
                occurred_at=occurred_at,
                due_date_at=due_date_at,
                total_minor=int(total_minor),
                allocated_minor=int(allocated),
                remaining_minor=remaining,
            )
        )
    invoices.sort(
        key=lambda inv: (
            inv.due_date_at is None,
            inv.due_date_at or inv.occurred_at,
            inv.occurred_at,
        )
    )
    return invoices


async def allocated_by_sale(session, business_id: str) -> dict[str, int]:
    result = await session.execute(
        select(PaymentAllocation.sale_id, func.sum(PaymentAllocation.amount_minor))
        .where(PaymentAllocation.business_id == business_id)
        .group_by(PaymentAllocation.sale_id)
    )
    return {row[0]: int(row[1]) for row in result.all()}


async def open_invoices_for_business(session, business_id: str) -> dict[str, list[OpenInvoice]]:
    sale_result = await session.execute(
        select(
            Sale.id,
            Sale.customer_id,
            Sale.created_at,
            Sale.due_date_at,
            func.sum(SalePayment.amount_minor),
        )
        .join(SalePayment, SalePayment.sale_id == Sale.id)
        .where(
            Sale.business_id == business_id,
            SalePayment.method == "credit",
            Sale.customer_id.is_not(None),
        )
        .group_by(Sale.id, Sale.customer_id, Sale.created_at, Sale.due_date_at)
    )
    allocated = await allocated_by_sale(session, business_id)
    invoices = _build_open_invoices(sale_result.all(), allocated)
    by_customer: dict[str, list[OpenInvoice]] = {}
    for inv in invoices:
        by_customer.setdefault(inv.customer_id, []).append(inv)
    return by_customer


async def open_invoices_for_customer(
    session, business_id: str, customer_id: str
) -> list[OpenInvoice]:
    """Every real caller of this function (take-payment, MoMo settlement,
    pay-link settlement -- see module docstring) uses the result to DECIDE
    how to allocate a payment, then writes `payment_allocations` rows based
    on that decision later in the same request. Without a lock here, two
    concurrent callers for the same customer (e.g. two independent
    take-payment requests -- not a retried request, a genuine race) can
    both read the same stale `remaining_minor` on an invoice and both fully
    allocate a payment to it, over-allocating that invoice by the second
    payment's full amount -- the same "check-then-write across a request
    boundary without locking the read" shape
    api/routers/sales.py::_check_stock's `.with_for_update()` fix closes for
    stock. `SELECT ... FOR UPDATE` can't be combined with the GROUP BY
    aggregate below (Postgres rejects that combination outright), so the
    lock is acquired first via a plain, ungrouped `SELECT Sale.id ...
    FOR UPDATE` over this customer's sales -- the second transaction blocks
    here until the first commits (including its `payment_allocations`
    insert), then its own subsequent read of `payment_allocations` sees
    that already-committed state instead of a stale one.
    """
    sale_ids_result = await session.execute(
        select(Sale.id)
        .where(Sale.business_id == business_id, Sale.customer_id == customer_id)
        .with_for_update()
    )
    sale_ids = [row[0] for row in sale_ids_result.all()]

    sale_result = await session.execute(
        select(
            Sale.id,
            Sale.customer_id,
            Sale.created_at,
            Sale.due_date_at,
            func.sum(SalePayment.amount_minor),
        )
        .join(SalePayment, SalePayment.sale_id == Sale.id)
        .where(
            Sale.business_id == business_id,
            Sale.customer_id == customer_id,
            SalePayment.method == "credit",
        )
        .group_by(Sale.id, Sale.customer_id, Sale.created_at, Sale.due_date_at)
    )
    alloc_result = await session.execute(
        select(PaymentAllocation.sale_id, func.sum(PaymentAllocation.amount_minor))
        .where(
            PaymentAllocation.business_id == business_id, PaymentAllocation.sale_id.in_(sale_ids)
        )
        .group_by(PaymentAllocation.sale_id)
    )
    allocated = {row[0]: int(row[1]) for row in alloc_result.all()}
    return _build_open_invoices(sale_result.all(), allocated)


def auto_allocate(
    invoices: list[OpenInvoice], amount_minor: int
) -> tuple[list[tuple[str, int]], int]:
    """Walks `invoices` (already oldest-first) allocating up to
    `amount_minor`. Returns `(allocations, unallocated_remainder)` --
    callers decide whether a nonzero remainder is an error (take-payment:
    yes, D.6.4 payments always fully allocate) or acceptable (a MoMo/pay-
    link settlement that happens to exceed total open invoices: land the
    excess as-is rather than reject a real payment that already arrived).
    """
    allocations: list[tuple[str, int]] = []
    remaining = amount_minor
    for inv in invoices:
        if remaining <= 0:
            break
        take = min(inv.remaining_minor, remaining)
        allocations.append((inv.sale_id, take))
        remaining -= take
    return allocations, remaining
