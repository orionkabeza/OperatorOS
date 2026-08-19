"""Idempotency key store.

Postgres-backed (spec G.1 leaves the choice open between Redis and
Postgres). Postgres was chosen specifically so the idempotency record can
be written in the *same transaction* as the event append + projection
update it guards — a unique constraint on (business_id, key) plus
`INSERT ... ON CONFLICT DO NOTHING` gives an atomic "claim this key or find
out someone already has" primitive with no separate distributed-lock
concern. See docs/DECISIONS.md.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from operatoros_api.models.base import Base, TimestampMixin, UUIDPKMixin


class IdempotencyKey(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "idempotency_keys"
    __table_args__ = (UniqueConstraint("business_id", "key", name="uq_idempotency_business_key"),)

    business_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(200), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    endpoint: Mapped[str] = mapped_column(String(200), nullable=False)
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response_body: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
