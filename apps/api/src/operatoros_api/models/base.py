from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def uuid7_str() -> str:
    """A UUIDv7 (time-ordered) id, as required by spec E.2 for `events.id`.

    We also use it for other primary keys — time-ordering primary keys is a
    free win for index locality and makes `ORDER BY id` a valid proxy for
    insertion order without a second column.
    """
    from uuid6 import uuid7

    return str(uuid7())


class UUIDPKMixin:
    id: Mapped[str] = mapped_column(primary_key=True, default=uuid7_str)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )


def new_uuid() -> str:
    return str(uuid.uuid4())
