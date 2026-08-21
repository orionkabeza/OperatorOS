#!/usr/bin/env node
/**
 * CI-style honesty gate, same spirit as apps/api's `no-float-money` test:
 * regenerates lib/api/generated/client.ts into a throwaway temp file from
 * the CURRENT apps/api/openapi.json and fails if it differs from the
 * committed file. Catches the case where apps/api/openapi.json changed
 * (a backend schema/route changed) but nobody re-ran
 * `npm run generate:api-client` and committed the result -- exactly the
 * kind of silent drift the Phase 0 "generated, not hand-written" rule
 * exists to prevent.
 */
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generate } from "./generate-api-client.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const committedPath = path.resolve(webRoot, "lib/api/generated/client.ts");

const tmpDir = mkdtempSync(path.join(tmpdir(), "operatoros-api-client-"));
const tmpPath = path.join(tmpDir, "client.ts");

try {
  generate(tmpPath);
  const committed = readFileSync(committedPath, "utf8");
  const fresh = readFileSync(tmpPath, "utf8");
  if (committed !== fresh) {
    console.error(
      "\napps/web/lib/api/generated/client.ts is STALE relative to apps/api/openapi.json.\n" +
        "Run this and commit the result:\n\n" +
        "  cd apps/api && .venv/Scripts/python.exe scripts/export_openapi.py\n" +
        "  cd apps/web && npm run generate:api-client\n",
    );
    process.exit(1);
  }
  console.log("lib/api/generated/client.ts is up to date with apps/api/openapi.json.");
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
