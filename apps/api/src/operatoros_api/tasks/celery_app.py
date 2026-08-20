"""Celery app + beat schedule (spec G.2: "a job queue for anything slow").

Phase 0 only wires one scheduled job -- the nightly projection audit
(E.3) -- to prove the queue/beat machinery works end-to-end. Reminders,
WhatsApp sends, EBM transmission, imports/exports land here in later
phases.
"""

from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from operatoros_api.config import get_settings

settings = get_settings()

celery_app = Celery(
    "operatoros",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["operatoros_api.tasks.projection_audit"],
)
celery_app.conf.timezone = "UTC"
celery_app.conf.task_always_eager = False
celery_app.conf.beat_schedule = {
    "nightly-projection-audit": {
        "task": "operatoros_api.tasks.projection_audit.run_projection_audit",
        "schedule": crontab(hour=2, minute=0),
    },
}
