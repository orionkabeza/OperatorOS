"""The event-append API (spec E.1/E.2/E.3): the only sanctioned way to
change tenant state. Validates the full envelope + payload against the
typed registry, inserts the row, and applies any registered projection
handler — all inside the caller's existing (tenant-scoped) transaction.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from operatoros_api.events_registry import get_payload_model
from operatoros_api.models.base import uuid7_str
from operatoros_api.models.events import Event
from operatoros_api.projections.framework import apply_projections

VALID_ACTOR_SOURCES = frozenset({"web", "mobile", "whatsapp", "api", "system"})


class EnvelopeValidationError(Exception):
    def __init__(self, message: str, errors: list[Any] | None = None) -> None:
        super().__init__(message)
        self.errors = errors or []


@dataclass(frozen=True)
class EventEnvelopeInput:
    business_id: str
    type: str
    payload: dict
    actor_user_id: str | None
    actor_source: str
    location_id: str | None = None
    device_id: str | None = None
    correlation_id: str | None = None
    occurred_at: datetime | None = None
    reverses_event_id: str | None = None
    corrects_event_id: str | None = None


async def append_event(session: AsyncSession, envelope: EventEnvelopeInput) -> Event:
    if envelope.actor_source not in VALID_ACTOR_SOURCES:
        raise EnvelopeValidationError(f"Invalid actor_source: {envelope.actor_source!r}")
    if not envelope.business_id:
        raise EnvelopeValidationError("business_id is required on every event.")

    try:
        payload_model = get_payload_model(envelope.type)
    except ValueError as exc:
        raise EnvelopeValidationError(str(exc)) from exc

    try:
        validated_payload = payload_model.model_validate(envelope.payload)
    except ValidationError as exc:
        raise EnvelopeValidationError(
            f"Payload failed validation for {envelope.type}", errors=exc.errors()
        ) from exc

    now = datetime.now(UTC)
    occurred_at = envelope.occurred_at or now

    row = Event(
        id=uuid7_str(),
        business_id=envelope.business_id,
        location_id=envelope.location_id,
        type=envelope.type,
        payload=validated_payload.model_dump(mode="json"),
        occurred_at=occurred_at,
        recorded_at=now,
        actor_user_id=envelope.actor_user_id,
        actor_source=envelope.actor_source,
        device_id=envelope.device_id,
        correlation_id=envelope.correlation_id or uuid7_str(),
        reverses_event_id=envelope.reverses_event_id,
        corrects_event_id=envelope.corrects_event_id,
        schema_version=payload_model.SCHEMA_VERSION,
    )
    session.add(row)
    await session.flush()

    await apply_projections(session, row)

    return row
