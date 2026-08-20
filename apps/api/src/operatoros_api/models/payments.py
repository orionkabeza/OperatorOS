"""`payment_allocations` — which invoice(s) a `PAYMENT_RECEIVED` event's
money was allocated to (spec D.6.4, plan §0.2).

Not a projection: allocation is a record of a *choice* made at write time
("auto-oldest-first" or manual per-invoice, D.6.4), not a value derivable
purely from replaying events (`PaymentReceivedPayload` carries no invoice
reference — see events_registry.py and plan §0.2). Written directly by
`api/routers/debt.py`'s take-payment endpoint, in the SAME transaction as
the `PAYMENT_RECEIVED` event append -- both succeed or both roll back
together, same as every other money-shaped write in this codebase.

`payment_event_id` is a plain string, not a foreign key: `events` is
range-partitioned by `occurred_at` with a composite primary key
`(id, occurred_at)` (see models/events.py's docstring), so a single-column
FK to `events.id` isn't possible -- exactly the same reason `Sale.source_event_id`
(models/sales.py) is a plain `String(36)` rather than a `ForeignKey`.

`sale_id` IS a real foreign key: the credit-bearing `Sale` a `payment_allocations`
row references is the invoice itself (plan §0.2 -- no separate `invoices`
table), and it lives in the same non-partitioned `sales` table `ForeignKey`
already works against elsewhere in this codebase.
"""

from __future__ import annotations

from sqlalchemy import BigInteger, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from operatoros_api.models.base import Base, TimestampMixin, UUIDPKMixin


class PaymentAllocation(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "payment_allocations"

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    payment_event_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    sale_id: Mapped[str] = mapped_column(
        ForeignKey("sales.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
