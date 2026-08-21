"""Celery app + beat schedule (spec G.2: "a job queue for anything slow").

Phase 0 only wires one scheduled job -- the nightly projection audit
(E.3) -- to prove the queue/beat machinery works end-to-end. Reminders,
WhatsApp sends, EBM transmission, imports/exports land here in later
phases.
"""

from __future__ import annotations

import ssl

from celery import Celery
from celery.schedules import crontab

from operatoros_api.config import get_settings

settings = get_settings()

# A `rediss://` URL (TLS -- any real managed Redis, e.g. Upstash) makes
# celery's redis transport/result-backend raise at startup unless SSL
# options are given explicitly; redis-py's own `from_url` (used
# elsewhere in this app, e.g. api/deps.py::get_redis) infers TLS from
# the scheme alone and needs no such thing -- this is purely a celery
# quirk. CERT_REQUIRED is the secure default (verify the server's real
# cert); local dev's plain `redis://` leaves this unset entirely.
_redis_tls_opts = (
    {"ssl_cert_reqs": ssl.CERT_REQUIRED} if settings.redis_url.startswith("rediss://") else None
)

celery_app = Celery(
    "operatoros",
    broker=settings.redis_url,
    backend=settings.redis_url,
    broker_use_ssl=_redis_tls_opts,
    redis_backend_use_ssl=_redis_tls_opts,
    include=[
        "operatoros_api.tasks.projection_audit",
        "operatoros_api.tasks.momo_settlement",
        "operatoros_api.tasks.recurring_expenses",
        "operatoros_api.tasks.reminders",
    ],
)
celery_app.conf.timezone = "UTC"
celery_app.conf.task_always_eager = False
celery_app.conf.beat_schedule = {
    "nightly-projection-audit": {
        "task": "operatoros_api.tasks.projection_audit.run_projection_audit",
        "schedule": crontab(hour=2, minute=0),
    },
    "recurring-expense-drafts": {
        "task": "operatoros_api.tasks.recurring_expenses.run_recurring_expenses",
        "schedule": crontab(hour=1, minute=0),
    },
    "reminder-schedule-tick": {
        # Plan §0.4: reminders check quiet hours/frequency guardrails
        # themselves per-send, so this can run frequently without
        # over-sending -- every 15 minutes catches a due step promptly
        # without hammering the DB.
        "task": "operatoros_api.tasks.reminders.run_reminder_tick",
        "schedule": crontab(minute="*/15"),
    },
}
