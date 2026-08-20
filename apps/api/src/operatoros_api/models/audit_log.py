"""The tamper-evident security audit log (spec G.1 "Auditing"; approved
plan §6).

This is a DIFFERENT thing from the `events` table (models/events.py):
`events` is the business system of record -- every state change a
feature makes, replayable to rebuild any projection. `audit_log` is
narrower and security-focused -- authentication and authorization
events specifically (who logged in, who failed to, who changed a role or
overrode a permission, who exported data) -- and it is hash-chained so
tampering with a row after the fact is detectable, which `events` is not
designed to guarantee on its own. See docs/DECISIONS.md for the full
reasoning on why both exist rather than one serving both purposes.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from operatoros_api.models.base import Base, uuid7_str


class AuditLogEntry(Base):
    __tablename__ = "audit_log"
    __table_args__ = (UniqueConstraint("business_id", "seq", name="uq_audit_log_business_seq"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid7_str)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    seq: Mapped[int] = mapped_column(BigInteger, nullable=False)
    event_type: Mapped[str] = mapped_column(String(60), nullable=False)
    actor_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    subject_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    detail: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    prev_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    hash: Mapped[str] = mapped_column(String(64), nullable=False)
