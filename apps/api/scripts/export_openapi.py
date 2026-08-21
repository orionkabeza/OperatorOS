"""Exports the live FastAPI OpenAPI schema to apps/api/openapi.json.

This is the source of truth apps/web's codegen (lib/api/generated/, see
packages/shared/src/index.ts's long-standing placeholder) reads from --
regenerate this file whenever a router/schema changes, then rerun the
frontend's `npm run generate:api-client`. `create_app()` builds the full
route table (including every Phase 0-2 router) without needing a live
Postgres/Redis connection -- FastAPI only needs the Python route/Pydantic
definitions to construct the schema, not a running database.
"""

from __future__ import annotations

import json
from pathlib import Path

from operatoros_api.main import create_app


def main() -> None:
    app = create_app()
    schema = app.openapi()
    out_path = Path(__file__).resolve().parent.parent / "openapi.json"
    out_path.write_text(json.dumps(schema, indent=2, sort_keys=True) + "\n")
    print(f"Wrote {len(schema['paths'])} paths to {out_path}")


if __name__ == "__main__":
    main()
