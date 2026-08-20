"""`pay_links` -- backs the public `/pay/{token}` page (spec D.6.5, plan
§0.5).

The `token` presented at `/pay/{token}` is NOT a column on this table --
it's a signed JWT (`security/tokens.py::create_pay_link_token`/
`decode_pay_link_token`) whose payload directly names `business_id` and
this row's `id`, verified by signature before any RLS-scoped query runs
(the same "identify the tenant from a server-signed claim first" shape
`create_access_token` already solves for logged-in sessions -- see
docs/DECISIONS.md). This is the second of the two places this phase
intentionally opens a hole in the normal tenant-auth wall (the first is
the MoMo webhook): there is no bearer token, no business_id header,
nothing beyond the signed capability itself -- possession of a validly
signed, unexpired token IS the authorization, scoped to exactly one
customer and one amount.

`status` moves pending -> paid or pending -> expired, never backwards --
enforced by `api/routers/pay.py` re-checking this row's LIVE status on
every presentation, not by tracking which token strings have been used
(there's nothing to look up a token string against): a still-
cryptographically-valid, not-yet-JWT-expired token whose row already
moved to `paid` must still be rejected. That's what makes this
"single-use" rather than merely "expiring."
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from operatoros_api.models.base import Base, TimestampMixin, UUIDPKMixin


class PayLink(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "pay_links"

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    location_id: Mapped[str] = mapped_column(
        ForeignKey("locations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    customer_id: Mapped[str] = mapped_column(
        ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    # "auto" (oldest-first, D.6.5's default) is the only allocation hint
    # this phase supports -- a specific sale_id hint is a natural future
    # extension, not built this phase since nothing in D.6.5's own
    # description of the pay link asks for per-invoice targeting from the
    # customer-facing link itself (that's what the manual allocation UI in
    # the take-payment drawer is for).
    allocation_hint: Mapped[str] = mapped_column(String(20), nullable=False, default="auto")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    provider: Mapped[str | None] = mapped_column(String(40), nullable=True)
    momo_external_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    payment_event_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
