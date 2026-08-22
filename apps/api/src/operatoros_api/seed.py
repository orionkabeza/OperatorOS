"""Shared seeding logic used by both `scripts/seed.py` (local dev) and
`tests/conftest.py` (test fixtures) -- one implementation, so a fixture
tenant is never subtly different from the tenant `make seed` gives a new
engineer locally.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from operatoros_api.capabilities import CAPABILITIES, DEFAULT_ROLE_CAPABILITIES, ROLES_REQUIRING_2FA
from operatoros_api.models.catalog import Unit
from operatoros_api.models.tenancy import (
    Business,
    Location,
    Permission,
    Role,
    RolePermission,
    User,
    UserLocation,
)
from operatoros_api.security.identifiers import hash_identifier
from operatoros_api.security.passwords import hash_secret


async def create_business(
    session: AsyncSession, *, name: str, slug: str, currency: str = "RWF"
) -> Business:
    business = Business(name=name, slug=slug.strip().lower(), currency=currency)
    session.add(business)
    await session.flush()
    return business


async def create_location(
    session: AsyncSession, *, business_id: str, name: str, is_primary: bool = True
) -> Location:
    location = Location(business_id=business_id, name=name, is_primary=is_primary)
    session.add(location)
    await session.flush()
    return location


# Every product needs a `base_unit_id`, so a business with no units cannot
# hold stock at all: `POST /products/import/commit` rejects the empty
# `default_unit_id` the frontend is forced to send with 422 "Unknown
# default_unit_id", which is exactly why a real CSV upload landed 0 of 40
# products. These are the units the app's own vocabulary already assumes
# (lib/mock/seed.ts's UNITS) -- a shop can rename or add to them, but it
# must not start with none.
DEFAULT_UNITS: tuple[tuple[str, str], ...] = (
    ("piece", "pc"),
    ("bag", "bag"),
    ("kg", "kg"),
    ("litre", "L"),
    ("box", "box"),
    ("carton", "ctn"),
)


async def seed_default_units(session: AsyncSession, *, business_id: str) -> list[Unit]:
    units = [
        Unit(business_id=business_id, name=name, symbol=symbol) for name, symbol in DEFAULT_UNITS
    ]
    session.add_all(units)
    await session.flush()
    return units


async def seed_default_roles_and_permissions(
    session: AsyncSession, *, business_id: str
) -> dict[str, Role]:
    """Seeds the fixed capability catalogue as `permissions` rows and the
    default role bundles (spec F.1/F.2) for one business. Returns
    {role_key: Role}."""
    roles: dict[str, Role] = {}
    for role_key in DEFAULT_ROLE_CAPABILITIES:
        role = Role(
            business_id=business_id,
            key=role_key,
            name=role_key.replace("_", " ").title(),
            is_system=True,
            requires_2fa=role_key in ROLES_REQUIRING_2FA,
        )
        session.add(role)
        roles[role_key] = role
    await session.flush()

    permissions: dict[str, Permission] = {}
    for cap_key, description in CAPABILITIES.items():
        permission = Permission(business_id=business_id, key=cap_key, description=description)
        session.add(permission)
        permissions[cap_key] = permission
    await session.flush()

    for role_key, cap_keys in DEFAULT_ROLE_CAPABILITIES.items():
        role = roles[role_key]
        for cap_key in cap_keys:
            session.add(
                RolePermission(
                    business_id=business_id, role_id=role.id, permission_id=permissions[cap_key].id
                )
            )
    await session.flush()
    return roles


async def create_user(
    session: AsyncSession,
    *,
    business_id: str,
    role: Role,
    display_name: str,
    secret: str,
    phone: str | None = None,
    email: str | None = None,
    location_ids: list[str] | None = None,
    totp_enabled: bool = False,
    totp_secret_encrypted: str | None = None,
) -> User:
    user = User(
        business_id=business_id,
        role_id=role.id,
        display_name=display_name,
        phone=phone,
        phone_hash=hash_identifier(phone) if phone else None,
        email=email,
        email_hash=hash_identifier(email) if email else None,
        auth_mode="pin",
        secret_hash=hash_secret(secret),
        status="active",
        totp_enabled=totp_enabled,
        totp_secret_encrypted=totp_secret_encrypted,
    )
    session.add(user)
    await session.flush()

    for location_id in location_ids or []:
        session.add(UserLocation(business_id=business_id, user_id=user.id, location_id=location_id))
    await session.flush()
    return user
