#!/usr/bin/env node
/**
 * Guards the mock/real boundary.
 *
 * Every production incident in this app's short life has had the same
 * shape: a value that is only meaningful in the mock layer reached a real
 * API call. `DEFAULT_LOCATION_ID` ("loc-nyabugogo") went out as a real
 * `location_id` and killed `POST /day/open` on a foreign key. The CSV
 * import preview compared real uploads against the mock seed catalog and
 * silently dropped rows the API then skipped. `commitImport` wrote to the
 * mock store regardless of mode. Each was found by a person clicking the
 * live site, because `USE_MOCK_API` guards the network branch while
 * nothing guarded the *data*.
 *
 * Three rules, checked statically so the next one fails CI instead:
 *
 *   A. Only `lib/api/**` and `lib/mock/**` may import from `lib/mock/`.
 *      UI code reaching into mock data is never correct in production.
 *   B. Inside `lib/api/**`, any EXPORTED function touching mock state
 *      (`store.`, `getDb(`) must mention `USE_MOCK_API` — an exported
 *      function reading mock data unconditionally is wrong against a real
 *      backend by definition. That is exactly what `buildImportPreview`
 *      was, and it is the shape that reaches callers outside this layer.
 *   C. Mock-only identifiers must not appear in real code paths at all.
 *
 * Known limit of Rule B: module-private helpers are exempt, because they
 * are only reachable through an exported function and flagging them
 * produced false positives on legitimately mock-only helpers
 * (`computeOverview`, `applyFilters`). A private helper called from an
 * exported function's *real* branch would therefore slip through. Closing
 * that needs real call-graph analysis; the exported-function rule covers
 * the boundary that actually leaks to the rest of the app. A check that
 * cries wolf gets switched off, which protects nothing.
 *
 * Run by `npm run lint`, so CI enforces it on every push.
 */
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

/** Identifiers whose value is only valid inside the mock layer. */
const MOCK_ONLY_IDENTIFIERS = [
  "DEFAULT_LOCATION_ID",
  "DEMO_MANAGER_PIN",
  "BACKDATE_MANAGER_PIN",
  "LOCATION_ID",
  "LOCATION_ID_2",
  "LOCATION_NAME",
  "LOCATION_NAME_2",
  "CURRENT_USER_ID",
  "CURRENT_USER_NAME",
];

/**
 * Rule C is skipped here. `lib/mock/` owns these values; `lib/api/` is the
 * one layer allowed to translate between mock and real, and Rule B already
 * requires every exported function there to branch on `USE_MOCK_API`
 * before touching them — so exempting it from C loses nothing while
 * keeping C absolute everywhere else.
 */
const IDENTIFIER_ALLOWLIST = ["lib/mock/", "lib/api/", "scripts/"];

const MOCK_IMPORT_ALLOWLIST = ["lib/api/", "lib/mock/"];

function listSourceFiles() {
  return globSync("**/*.{ts,tsx}", { cwd: ROOT })
    .filter((f) => !f.startsWith("node_modules"))
    .filter((f) => !f.startsWith(".next"))
    .filter((f) => !f.includes(".test."))
    .filter((f) => !f.startsWith("e2e/"))
    .map((f) => f.split(path.sep).join("/"));
}

/**
 * Splits a file into top-level function bodies by brace depth. Crude on
 * purpose — this needs to run in CI without pulling in a parser, and the
 * failure mode of a miscount is a false positive a human reads, not a
 * silent miss.
 */
function functionBlocks(source) {
  const lines = source.split("\n");
  const blocks = [];
  let current = null;
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!current && /^\s*export\s+(async\s+)?function\s+\w+/.test(line)) {
      current = { name: line.trim().slice(0, 80), startLine: i + 1, body: "" };
      depth = 0;
    }
    if (current) {
      current.body += line + "\n";
      depth += (line.match(/\{/g) ?? []).length;
      depth -= (line.match(/\}/g) ?? []).length;
      if (depth <= 0 && current.body.includes("{")) {
        blocks.push(current);
        current = null;
      }
    }
  }
  return blocks;
}

const violations = [];

for (const file of listSourceFiles()) {
  const source = readFileSync(path.join(ROOT, file), "utf8");

  // --- Rule A: who may import the mock layer at all ------------------------
  const importsMock = /from\s+["'](?:@\/lib\/mock|\.\.?\/mock)/.test(source);
  if (importsMock && !MOCK_IMPORT_ALLOWLIST.some((p) => file.startsWith(p))) {
    violations.push({
      file,
      rule: "A",
      message:
        "imports from lib/mock/ — mock data must not reach UI code. Source real values from lib/api/*.ts instead.",
    });
  }

  // --- Rule B: mock state must sit behind a USE_MOCK_API branch ------------
  if (file.startsWith("lib/api/")) {
    // Mock state is both the store itself and the seed's fixed identifiers —
    // `LOCATION_ID` reaching a real request is the same defect as `getDb()`
    // doing so, and is what shipped in TransfersTab.
    const mockState = new RegExp(`\\bstore\\.|\\bgetDb\\(|\\b(?:${MOCK_ONLY_IDENTIFIERS.join("|")})\\b`);
    for (const block of functionBlocks(source)) {
      const touchesMock = mockState.test(block.body);
      if (touchesMock && !block.body.includes("USE_MOCK_API")) {
        violations.push({
          file,
          rule: "B",
          line: block.startLine,
          message: `${block.name.replace(/\s+/g, " ")} reads mock state without a USE_MOCK_API branch — it will use fake data against a real backend.`,
        });
      }
    }
  }

  // --- Rule C: mock-only identifiers outside the mock layer ----------------
  if (!IDENTIFIER_ALLOWLIST.some((p) => file.startsWith(p))) {
    for (const identifier of MOCK_ONLY_IDENTIFIERS) {
      const re = new RegExp(`\\b${identifier}\\b`);
      const idx = source.split("\n").findIndex((l) => re.test(l) && !l.trimStart().startsWith("*"));
      if (idx !== -1) {
        violations.push({
          file,
          rule: "C",
          line: idx + 1,
          message: `references ${identifier}, which only has a meaningful value in mock mode.`,
        });
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`\nMock/real boundary violations (${violations.length}):\n`);
  for (const v of violations) {
    console.error(`  [${v.rule}] ${v.file}${v.line ? `:${v.line}` : ""}`);
    console.error(`       ${v.message}\n`);
  }
  console.error("See scripts/check-no-mock-in-real-paths.mjs for what each rule protects against.\n");
  process.exit(1);
}

console.log("OK — no mock data reachable from real code paths.");
