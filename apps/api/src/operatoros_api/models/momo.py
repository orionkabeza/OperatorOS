"""Mobile-money staging tables (spec D.7.3, plan §0.3/§1).

All plain entity tables, directly CRUD-able (no projection framework
involvement) -- a MoMo transaction landing from a webhook, or being
matched by a human in the reconciliation tab, is exactly the kind of
"state, not derived aggregate" data `customers`/`sales` already model this
way.

`MomoTransaction` is idempotent on `(business_id, provider, external_id)`
(plan §3: "webhook endpoints are idempotent on (provider, external_id)
instead" of the usual `Idempotency-Key` header, since an external system --
not our own client -- controls retries here).

`MomoWebhookNonce` is the timestamp+nonce replay-protection ledger (spec
Part G.1) -- separate from the idempotency story above: a captured,
byte-for-byte-replayed, VALIDLY SIGNED webhook call must still be rejected
even though it would otherwise resolve to the same `external_id` (which
the idempotency check alone would just silently accept as "already
processed, return 200"). Nonce rows are kept only long enough to matter
(the same ~5 minute window `security/webhooks.py::MAX_CLOCK_SKEW` accepts
for the timestamp) -- see that module for why a short window is what
makes the table's size and lookup cost bounded regardless of tenant count.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from operatoros_api.models.base import Base, TimestampMixin, UUIDPKMixin


class MomoProviderCredential(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "momo_provider_credentials"
    __table_args__ = (
        UniqueConstraint("business_id", "provider", name="uq_momo_credentials_business_provider"),
    )

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    # security/crypto.py::encrypt_secret -- the shared HMAC signing secret
    # this tenant and the provider both know. Decrypted only in the one
    # request path that needs it (webhook signature verification / request
    # signing before a real network call in a live provider).
    encrypted_secret: Mapped[str] = mapped_column(String(500), nullable=False)
    merchant_ref: Mapped[str | None] = mapped_column(String(80), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="connected")
    connected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    disconnected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class MomoTransaction(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "momo_transactions"
    __table_args__ = (
        UniqueConstraint(
            "business_id", "provider", "external_id", name="uq_momo_transactions_external_id"
        ),
    )

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    external_id: Mapped[str] = mapped_column(String(100), nullable=False)
    phone: Mapped[str] = mapped_column(String(32), nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    direction: Mapped[str] = mapped_column(String(10), nullable=False)  # in | out
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="unmatched")
    matched_to_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    matched_to_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    matched_event_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class MomoWebhookNonce(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "momo_webhook_nonces"
    __table_args__ = (
        UniqueConstraint("business_id", "provider", "nonce", name="uq_momo_webhook_nonce"),
    )

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    nonce: Mapped[str] = mapped_column(String(100), nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
