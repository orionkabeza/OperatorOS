"""Pre-auth tenant resolution.

D.1's Shutter identifies the business by subdomain/last-used tenant before
the login form is even shown — there is no global cross-tenant identifier
lookup in this product. Phase 0 has no real subdomain routing (no
frontend host yet), so the API accepts an explicit `business_slug` on
login/refresh in its place; a later phase can derive it from the Host
header without changing anything below this line.

`businesses` is the one table without RLS (see models/tenancy.py). That is
intentional, not an oversight: RLS binds `business_id` on every *tenant*
row to the session GUC, but `businesses` rows aren't tenant-owned data --
they're the tenant roots themselves, and resolving "does slug X exist" has
to be answerable before any tenant GUC can be set. The query below only
ever returns id/slug/name/status/currency -- never anything a competitor
tenant could use to see another business's operational data. See
docs/DECISIONS.md.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from operatoros_api.models.tenancy import Business


async def resolve_business_by_slug(session: AsyncSession, slug: str) -> Business | None:
    result = await session.execute(select(Business).where(Business.slug == slug.strip().lower()))
    return result.scalar_one_or_none()
