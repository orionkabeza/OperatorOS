"""Customer segments and broadcast sends (spec D.6.8, plan §0.7).

"Segments are saved, auto-updating filters, not materialized member
lists -- computed live so counts are never stale." `CustomerSegment`
therefore stores only `filter_spec` (a small JSON filter definition);
membership is computed on read by `segments_engine.py`, never persisted.

`BroadcastSend` IS a record of something that already happened (a batch
send), so unlike `CustomerSegment` it stores a snapshot -- `segment_snapshot`
freezes which customers were actually targeted at send time, so "who did
we message and when" (D.6.8) stays answerable even if the segment's live
membership changes afterward.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from operatoros_api.models.base import Base, TimestampMixin, UUIDPKMixin


class CustomerSegment(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "customer_segments"

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # {"kind": "bought_in_last_days", "days": 30} | {"kind": "inactive_since_days", "days": 60}
    # | {"kind": "top_n_by_spend", "n": 20} | {"kind": "custom", ...} -- see
    # segments_engine.py for the interpreter. A small closed vocabulary of
    # filter kinds (matching D.6.8's own named examples) rather than a
    # general query builder.
    filter_spec: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_by_user_id: Mapped[str] = mapped_column(String(36), nullable=False)


class BroadcastSend(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "broadcast_sends"

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    segment_id: Mapped[str | None] = mapped_column(
        ForeignKey("customer_segments.id", ondelete="SET NULL"), nullable=True
    )
    segment_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    link_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    sent_by_user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    recipient_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    delivered_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    read_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
