"""The event ledger table (spec E.2).

The actual table is created by raw DDL in the Alembic migration because it
is RANGE-partitioned by month (`PARTITION BY RANGE (occurred_at)`), which
SQLAlchemy's declarative layer does not model natively. This class exists
so the ORM can read/insert rows through the normal Session API — Alembic
does not autogenerate against it (`events` is excluded from autogenerate
diffing; see alembic/env.py).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from operatoros_api.models.base import Base, uuid7_str


class Event(Base):
    __tablename__ = "events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid7_str)
    business_id: Mapped[str] = mapped_column(String(36), nullable=False)
    location_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    type: Mapped[str] = mapped_column(String(60), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, primary_key=True
    )
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    actor_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    actor_source: Mapped[str] = mapped_column(String(20), nullable=False)
    device_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    correlation_id: Mapped[str] = mapped_column(String(36), nullable=False)
    reverses_event_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    corrects_event_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    idempotency_key: Mapped[str | None] = mapped_column(Text, nullable=True)
