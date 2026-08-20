"""Recurring-expense draft creation (spec D.7.4: "Recurring expenses can
be scheduled and auto-created as tasks"), run nightly via Celery beat.

Creates a `draft` `Expense` row (never auto-posted -- plan §0.6: "a draft
can still be edited or rejected before it becomes an immutable fact") for
every active `RecurringExpense` whose `next_run_date` has arrived, then
advances `next_run_date` by its interval
(`api/routers/expenses.py::advance_next_run_date`, shared so the CRUD
endpoints and this task can never compute the next date two different
ways).
"""

from __future__ import annotations

import asyncio
from datetime import date

from sqlalchemy import select

from operatoros_api.api.routers.expenses import advance_next_run_date
from operatoros_api.db import tenant_scoped_session
from operatoros_api.models.expenses import Expense, RecurringExpense
from operatoros_api.models.tenancy import Business
from operatoros_api.tasks.celery_app import celery_app


async def _create_due_drafts_for_business(business_id: str) -> int:
    today = date.today()
    created = 0
    async with tenant_scoped_session(business_id) as session:
        result = await session.execute(
            select(RecurringExpense).where(
                RecurringExpense.business_id == business_id,
                RecurringExpense.active.is_(True),
                RecurringExpense.next_run_date <= today,
            )
        )
        for recurring in result.scalars():
            session.add(
                Expense(
                    business_id=business_id,
                    location_id=recurring.location_id,
                    amount_minor=recurring.amount_minor,
                    category=recurring.category,
                    money_location=recurring.money_location,
                    payee=recurring.payee,
                    expense_date=today,
                    note=recurring.note,
                    status="draft",
                    created_by_user_id=recurring.created_by_user_id,
                    recurring_expense_id=recurring.id,
                )
            )
            recurring.next_run_date = advance_next_run_date(
                recurring.next_run_date, recurring.interval
            )
            created += 1
        await session.flush()
    return created


async def run_recurring_expenses_async() -> int:
    async with tenant_scoped_session(None) as session:
        # `businesses` has no RLS -- see tenancy_resolution.py -- so this
        # is a legitimate place to enumerate every tenant, same as the
        # nightly projection audit.
        result = await session.execute(select(Business.id))
        business_ids = [row[0] for row in result.all()]

    total = 0
    for business_id in business_ids:
        total += await _create_due_drafts_for_business(business_id)
    return total


@celery_app.task(name="operatoros_api.tasks.recurring_expenses.run_recurring_expenses")
def run_recurring_expenses() -> int:
    return asyncio.run(run_recurring_expenses_async())
