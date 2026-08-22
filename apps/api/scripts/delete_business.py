#!/usr/bin/env python3
"""Permanently delete one or more businesses and everything they own.

Admin cleanup for demo/test tenants -- there is deliberately no product
feature for this, and no API endpoint: the app's own role is granted only
SELECT/INSERT/UPDATE on `businesses`, so this needs the migration
credential (`OPERATOROS_DATABASE_URL_MIGRATE`) and a human running it.

    cd apps/api
    sudo -E bash -c 'set -a; source .env; set +a; \
        .venv/bin/python scripts/delete_business.py --keep demo-c6ed09'

    # or name them explicitly
    .venv/bin/python scripts/delete_business.py demo-143aee demo-703186

Two things make this less trivial than a DELETE:

1. **Projection tables reject direct writes.** Every tenant table cascades
   from `businesses.id`, but the event-sourced projections
   (`money_location_balance` and friends) carry a
   `reject_direct_projection_write()` trigger that refuses any write not
   coming through the projection framework -- including the DELETE that a
   foreign-key cascade issues. The guard is correct and worth keeping, so
   this disables those triggers for the duration of the delete and
   re-enables them afterwards. The tables are discovered from `pg_trigger`
   rather than hard-coded, so a projection added later is covered without
   anyone remembering to update this list.

2. **It must be all-or-nothing.** Everything runs in one transaction.
   Postgres DDL is transactional, so if the delete fails the trigger
   re-enable rolls back with it -- there is no path where the guards are
   left switched off.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402

FIND_PROJECTION_GUARDS = text(
    """
    SELECT DISTINCT c.relname AS table_name
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE p.proname = 'reject_direct_projection_write'
      AND NOT t.tgisinternal
    """
)


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("slugs", nargs="*", help="business slugs to delete")
    parser.add_argument(
        "--keep",
        action="append",
        default=[],
        help="delete every business EXCEPT these slugs (repeatable)",
    )
    parser.add_argument(
        "--yes", action="store_true", help="skip the confirmation prompt (for scripts)"
    )
    args = parser.parse_args()

    if bool(args.slugs) == bool(args.keep):
        parser.error("give either slugs to delete, or --keep, but not both")

    url = os.environ.get("OPERATOROS_DATABASE_URL_MIGRATE")
    if not url:
        print(
            "OPERATOROS_DATABASE_URL_MIGRATE is not set. The app's own role has no "
            "DELETE grant on businesses -- that is deliberate, so this needs the "
            "migration credential.",
            file=sys.stderr,
        )
        return 2

    engine = create_async_engine(url)
    try:
        async with engine.begin() as conn:
            if args.slugs:
                where, params = "slug = ANY(:slugs)", {"slugs": args.slugs}
            else:
                where, params = "slug <> ALL(:keep)", {"keep": args.keep}

            doomed = [
                r.slug
                for r in (
                    await conn.execute(text(f"SELECT slug FROM businesses WHERE {where}"), params)
                ).fetchall()
            ]
            if not doomed:
                print("Nothing matched — no businesses deleted.")
                return 0

            print(f"About to permanently delete {len(doomed)} business(es):")
            for slug in doomed:
                print(f"  - {slug}")
            if not args.yes and input("Type 'delete' to confirm: ").strip() != "delete":
                print("Aborted — nothing was deleted.")
                return 1

            guarded = [
                r.table_name for r in (await conn.execute(FIND_PROJECTION_GUARDS)).fetchall()
            ]
            for table in guarded:
                await conn.execute(text(f'ALTER TABLE "{table}" DISABLE TRIGGER USER'))

            deleted = (
                await conn.execute(text(f"DELETE FROM businesses WHERE {where}"), params)
            ).rowcount

            for table in guarded:
                await conn.execute(text(f'ALTER TABLE "{table}" ENABLE TRIGGER USER'))

            remaining = [
                r.slug
                for r in (
                    await conn.execute(text("SELECT slug FROM businesses ORDER BY slug"))
                ).fetchall()
            ]

        print(f"\nDeleted {deleted} business(es).")
        print(f"Projection guards re-enabled on: {', '.join(guarded) or 'none found'}")
        print(f"Remaining businesses: {remaining or 'none'}")
        return 0
    finally:
        await engine.dispose()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
