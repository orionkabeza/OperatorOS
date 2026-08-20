"""`money_locations` — account metadata backing the Cash Box's balances band
(spec D.7.1, plan §1).

This is a plain, directly CRUD-able entity table, NOT a projection — it is
deliberately distinct from `MoneyLocationBalance` (`models/projections.py`),
which holds the actual running balance per `(business_id, location_id,
account_key)` and is written only through the projection framework. This
table holds the *display* metadata a balance alone can't carry: a
human-friendly label ("BANK (BK ••4192)"), a masked account number, whether
it's a manually-tracked account or one connected to a live sync (mobile
money via `SandboxMomoProvider`, plan §0.3), and when it last synced.

`account_key` is the same string `money_location_balance.account_key` and
`SALE_RECORDED`/`EXPENSE_RECORDED` payment-method-driven account keys use
("till", "momo", "airtel", "bank", "card", "cheque") — this table is looked
up by that key to decorate a balance row for display, never the other way
around. A business that never explicitly configures a money location still
gets correct balances (the projection handlers create rows on first use
regardless); `api/routers/cashbox.py`'s balances-band endpoint falls back to
a sensible default display name when no matching `money_locations` row
exists yet, so "no metadata configured" never means "no balance shown."
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from operatoros_api.models.base import Base, TimestampMixin, UUIDPKMixin


class MoneyLocation(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "money_locations"
    __table_args__ = (
        UniqueConstraint(
            "business_id", "location_id", "account_key", name="uq_money_locations_account"
        ),
    )

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    location_id: Mapped[str] = mapped_column(
        ForeignKey("locations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    account_key: Mapped[str] = mapped_column(String(40), nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    masked_account_number: Mapped[str | None] = mapped_column(String(40), nullable=True)
    # till | momo | airtel | bank | card | cheque | other -- the account's
    # kind for icon/behaviour purposes. Usually equal to account_key today
    # (one account per kind per location), kept as its own column because
    # account_key is the money_location_balance join key (must stay unique
    # per location) while kind is a display/category concept that a future
    # phase (multiple bank accounts at one location) could legitimately
    # decouple from account_key without a schema change here.
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    connection_status: Mapped[str] = mapped_column(String(20), nullable=False, default="manual")
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
