#!/usr/bin/env python3
"""Seed one local demo business + Owner user against the real dev
database (OPERATOROS_DATABASE_URL -- the docker-compose Postgres by
default, NOT the ephemeral embedded one the test suite uses).

Run via `make seed` from the repo root, or directly:
    cd apps/api && python scripts/seed.py

Prints the login details (business slug, phone, PIN) at the end so a new
engineer can sign in immediately. Not idempotent by design -- every run
creates a fresh business with a fresh random slug, the same way a real
new tenant signs up; there is no "the demo business" to collide with.
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from operatoros_api.db import tenant_scoped_session  # noqa: E402
from operatoros_api.seed import (  # noqa: E402
    create_business,
    create_location,
    create_user,
    seed_default_roles_and_permissions,
)


async def main() -> None:
    suffix = uuid.uuid4().hex[:6]
    slug = f"demo-{suffix}"
    phone = "+250788000000"
    pin = "482913"

    async with tenant_scoped_session(None) as session:
        business = await create_business(session, name="Kigali Hardware Demo", slug=slug)
        business_id = business.id

    async with tenant_scoped_session(business_id) as session:
        location = await create_location(session, business_id=business_id, name="Main Shop")
        roles = await seed_default_roles_and_permissions(session, business_id=business_id)
        owner = await create_user(
            session,
            business_id=business_id,
            role=roles["owner"],
            display_name="Demo Owner",
            secret=pin,
            phone=phone,
            location_ids=[location.id],
        )

    print("Seeded a demo business.")
    print(f"  business_slug: {slug}")
    print(f"  location:      {location.name} ({location.id})")
    print(f"  owner user:    {owner.display_name} ({owner.id})")
    print(f"  login phone:   {phone}")
    print(f"  login PIN:     {pin}")
    print()
    print("POST /api/v1/auth/login with:")
    print(
        '  {"business_slug": "%s", "identifier": "%s", "secret": "%s", "device_id": "local-dev"}'
        % (slug, phone, pin)
    )


if __name__ == "__main__":
    asyncio.run(main())
