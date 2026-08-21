"""Notification sending seam (plan §0.4).

`Send on WhatsApp`/`Send by SMS` (spec D.4) are stubbed the same way Phase
0 stubbed OTP delivery: a real interface with a console/log-backed
implementation for local dev, and a documented seam for the real WhatsApp
Business API / SMS gateway integration in Phase 5 (spec D.12). Nothing
about the API contract (`receipts` router) needs to change when a real
implementation is swapped in -- only `get_notification_sender()`'s return
value.
"""

from __future__ import annotations

from typing import Protocol

import structlog

from operatoros_api.security.identifiers import hash_identifier

logger = structlog.get_logger("operatoros_api.notifications")


class NotificationSender(Protocol):
    async def send(self, *, channel: str, to: str, subject: str, body: str) -> str:
        """Returns an opaque provider message id (or a local stub id)."""
        ...


class LoggingNotificationSender:
    """Local-dev/test implementation: logs the send and returns a fake id.
    Real WhatsApp Business API / SMS gateway implementations land behind
    this same Protocol in a later phase -- see module docstring."""

    async def send(self, *, channel: str, to: str, subject: str, body: str) -> str:
        message_id = f"stub-{channel}-{abs(hash((to, subject, body)))}"
        logger.info(
            "notification_sent_stub",
            channel=channel,
            to_hash=hash_identifier(to),
            subject_length=len(subject),
            message_id=message_id,
        )
        return message_id


_sender: NotificationSender = LoggingNotificationSender()


def get_notification_sender() -> NotificationSender:
    return _sender
