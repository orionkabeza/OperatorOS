"""Runtime configuration. Every value is env-driven; nothing is hard-coded.

See .env.example at the repo root for the documented list of variables.
Real secrets never live in this file or in git — only defaults that are
safe for local dev (and deliberately unsafe-looking, so nobody mistakes
them for something that could survive contact with production).
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# These mirror the two local-dev-only Field defaults below, byte-for-byte,
# so the fail-closed check further down can detect "still using the
# committed default" outside env=local. Not real credentials -- bandit's
# hardcoded-password heuristic matches on the variable name alone; nosec
# is scoped to these two lines, not the rule globally (same convention as
# security/webhooks.py's _DUMMY_SECRET).
_INSECURE_DEFAULT_JWT_SECRET = "local-dev-only-secret-change-me-please"  # nosec B105
_INSECURE_DEFAULT_ENCRYPTION_KEY = "3OIG0lvVcsGpLImnOWQHs7HqnEhJXlwvHfK7hewA1vg="  # nosec B105


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

    # File storage (storage.py::LocalDiskStorage -- see that module's
    # docstring for why this is local disk, not S3, this phase).
    uploads_dir: str = Field(default="uploads")

    @field_validator("jwt_secret")
    @classmethod
    def _warn_default_secret(cls, v: str) -> str:
        # The actual enforcement is the fail-closed model_validator below —
        # this stays a no-op field validator so the field-level intent
        # (jwt_secret is meant to be overridden outside local dev) is
        # documented next to the field itself.
        return v

    @model_validator(mode="after")
    def _fail_closed_on_default_secrets_outside_local(self) -> Settings:
        # A hard failure, not a warning: tests/local dev rely on these
        # defaults to work out of the box with zero setup, but shipping
        # either default to a real environment would mean every deployment
        # shares the same publicly-visible (this file is committed) JWT
        # signing key and encryption key. Refusing to start is the only
        # safe behavior once `env` is anything other than "local" — a log
        # line is easy to miss, a crashed process is not.
        if self.env != "local":
            insecure = []
            if self.jwt_secret == _INSECURE_DEFAULT_JWT_SECRET:
                insecure.append("OPERATOROS_JWT_SECRET")
            if self.secret_encryption_key == _INSECURE_DEFAULT_ENCRYPTION_KEY:
                insecure.append("OPERATOROS_SECRET_ENCRYPTION_KEY")
            if insecure:
                raise ValueError(
                    f"Refusing to start with env={self.env!r}: the following settings are "
                    f"still using their insecure local-dev default values: "
                    f"{', '.join(insecure)}. Set real per-environment secrets before "
                    "deploying outside env=local. See docs/RUNBOOK.md."
                )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
