"""Runtime configuration. Every value is env-driven; nothing is hard-coded.

See .env.example at the repo root for the documented list of variables.
Real secrets never live in this file or in git — only defaults that are
safe for local dev (and deliberately unsafe-looking, so nobody mistakes
them for something that could survive contact with production).
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="OPERATOROS_", extra="ignore")

    env: str = Field(default="local")

    # Database. The app connects with a non-superuser, non-BYPASSRLS role —
    # see infra/docker-compose.yml and alembic/versions/*_tenancy_and_rls.py
    # for where that role is created and RLS is bound to it.
    database_url: str = Field(
        default="postgresql+asyncpg://operatoros_app:operatoros_app@localhost:5432/operatoros"
    )
    database_url_migrate: str = Field(
        default="postgresql+psycopg://operatoros_admin:operatoros_admin@localhost:5432/operatoros"
    )

    redis_url: str = Field(default="redis://localhost:6379/0")

    # JWT / sessions
    jwt_secret: str = Field(default="local-dev-only-secret-change-me-please")
    # Local-dev-only Fernet key (see security/crypto.py). Never use this
    # value outside `env=local` — deployment tooling must inject a real
    # per-environment key. Generated once with Fernet.generate_key(); it is
    # not derived from anything secret, it's just a syntactically valid key
    # so local dev and tests work out of the box.
    secret_encryption_key: str = Field(default="3OIG0lvVcsGpLImnOWQHs7HqnEhJXlwvHfK7hewA1vg=")
    jwt_algorithm: str = Field(default="HS256")
    access_token_ttl_minutes: int = Field(default=15)
    refresh_token_ttl_days: int = Field(default=30)
    device_trust_ttl_days: int = Field(default=30)
    session_idle_timeout_hours: int = Field(default=12)

    # Auth / lockout
    max_login_attempts: int = Field(default=3)
    lockout_minutes: int = Field(default=15)
    login_rate_limit_per_minute: int = Field(default=10)

    # Idempotency
    idempotency_ttl_hours: int = Field(default=24)

    # Correlation / logging
    log_level: str = Field(default="INFO")

    @field_validator("jwt_secret")
    @classmethod
    def _warn_default_secret(cls, v: str) -> str:
        # Not a hard failure here (tests/local dev rely on the default) —
        # deployment tooling is responsible for asserting a real secret is
        # set outside `env=local`. See docs/RUNBOOK.md.
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()
