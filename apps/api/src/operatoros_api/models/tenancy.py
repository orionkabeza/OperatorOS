"""Tenancy, auth, and permission entity tables.

Every table here except `Business` carries `business_id NOT NULL` and is
protected by Postgres RLS (ENABLE + FORCE), bound to the session GUC
`app.business_id`. See alembic/versions/0001_tenancy_and_rls.py for the
actual policies — this module only defines table shape.

`permissions` is included in the "every tenant table" set per the approved
plan's literal table list, so each business gets its own copy of the fixed
capability catalog (seeded identically at business creation — see
operatoros_api.capabilities.DEFAULT_CAPABILITIES). This is a deliberate
choice to avoid a second RLS-exempt "system" table class beyond `businesses`
itself; see docs/DECISIONS.md.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from operatoros_api.models.base import Base, TimestampMixin, UUIDPKMixin


class Business(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "businesses"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False, unique=True, index=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="RWF")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")


class Location(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "locations"

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class Role(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "roles"
    __table_args__ = (UniqueConstraint("business_id", "key", name="uq_roles_business_key"),)

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    key: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    requires_2fa: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class Permission(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "permissions"
    __table_args__ = (UniqueConstraint("business_id", "key", name="uq_permissions_business_key"),)

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    key: Mapped[str] = mapped_column(String(80), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")


class RolePermission(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "role_permissions"
    __table_args__ = (
        UniqueConstraint("role_id", "permission_id", name="uq_role_permissions_role_perm"),
    )

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role_id: Mapped[str] = mapped_column(
        ForeignKey("roles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    permission_id: Mapped[str] = mapped_column(
        ForeignKey("permissions.id", ondelete="CASCADE"), nullable=False, index=True
    )


class User(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "users"
    __table_args__ = (
        Index("ix_users_business_phone_hash", "business_id", "phone_hash"),
        Index("ix_users_business_email_hash", "business_id", "email_hash"),
    )

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role_id: Mapped[str] = mapped_column(
        ForeignKey("roles.id", ondelete="RESTRICT"), nullable=False
    )
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    phone_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    email_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    auth_mode: Mapped[str] = mapped_column(String(10), nullable=False, default="pin")
    secret_hash: Mapped[str] = mapped_column(Text, nullable=False)
    totp_secret_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    language: Mapped[str] = mapped_column(String(5), nullable=False, default="en")

    role: Mapped[Role] = relationship(lazy="joined")


class UserLocation(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "user_locations"
    __table_args__ = (
        UniqueConstraint("user_id", "location_id", name="uq_user_locations_user_location"),
    )

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    location_id: Mapped[str] = mapped_column(
        ForeignKey("locations.id", ondelete="CASCADE"), nullable=False, index=True
    )


class UserGrant(Base, UUIDPKMixin, TimestampMixin):
    """Per-user capability grant/revoke layered on top of the role bundle.

    `effect` is `grant` or `revoke`. `location_id` NULL means "all locations
    this user is assigned to"; a non-null value scopes the grant/revoke to
    one location only (F.2 scoping).
    """

    __tablename__ = "user_grants"

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    permission_key: Mapped[str] = mapped_column(String(80), nullable=False)
    effect: Mapped[str] = mapped_column(String(10), nullable=False)
    location_id: Mapped[str | None] = mapped_column(
        ForeignKey("locations.id", ondelete="CASCADE"), nullable=True
    )
    created_by_user_id: Mapped[str | None] = mapped_column(nullable=True)


class DeviceSession(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "device_sessions"

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    device_id: Mapped[str] = mapped_column(String(100), nullable=False)
    device_fingerprint: Mapped[str | None] = mapped_column(String(200), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip_created: Mapped[str | None] = mapped_column(String(64), nullable=True)
    trusted_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RefreshToken(Base, UUIDPKMixin, TimestampMixin):
    """One row per issued refresh token, chained by `family_id`.

    Rotation: on refresh, the presented token is marked `used_at` and a new
    row is created in the same `family_id` with `previous_token_id` set to
    the old row's id. Reuse detection: if a token with `used_at IS NOT NULL`
    (or `revoked_at IS NOT NULL`) is presented again, the *entire family* is
    revoked (see security/tokens.py::rotate_refresh_token).
    """

    __tablename__ = "refresh_tokens"
    __table_args__ = (Index("ix_refresh_tokens_family", "family_id"),)

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    device_session_id: Mapped[str] = mapped_column(
        ForeignKey("device_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    family_id: Mapped[str] = mapped_column(String(36), nullable=False)
    previous_token_id: Mapped[str | None] = mapped_column(nullable=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_reason: Mapped[str | None] = mapped_column(String(100), nullable=True)


class LoginAttempt(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "login_attempts"

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    identifier_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    user_id: Mapped[str | None] = mapped_column(nullable=True)
    succeeded: Mapped[bool] = mapped_column(Boolean, nullable=False)
    reason: Mapped[str | None] = mapped_column(String(100), nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    device_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
