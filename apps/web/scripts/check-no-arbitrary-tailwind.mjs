#!/usr/bin/env node
/**
 * Enforces "no arbitrary Tailwind values" (spec: "Put the palette, type
 * scale, spacing scale, and radius into tailwind.config.ts as the only
 * available values... No arbitrary Tailwind values (text-[#hex], p-[13px]).
 * add a lint rule blocking them.").
 *
 * `eslint-plugin-tailwindcss`'s `no-arbitrary-value` rule is what this
 * should have been — it crashes in this workspace ("Could not resolve
 * tailwindcss", a resolution bug in tailwind-api-utils that also breaks
 * `next lint` outright, not just this one rule) — see docs/DECISIONS.md.
 * This script is the actual enforcement in the meantime: a regex gate over
 * `className`/`clsx`/`cx` usages for Tailwind's `prefix-[value]` syntax,
 * run from `npm run lint` and CI. Simple on purpose — replace with the real
 * ESLint rule the moment the upstream bug is fixed.
 */
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// Matches e.g. `text-[#fff]`, `p-[13px]`, `top-[8%]`, `w-[calc(100%-4px)]` —
// but NOT variant syntax like `data-[state=open]:foo` or `aria-[expanded=true]:foo`,
// which is a legitimate, common Tailwind feature (conditional on an
// attribute), not an arbitrary value. The distinguishing signal: a variant
// bracket is always followed by `:`; a value bracket is terminal.
const ARBITRARY_VALUE_RE = /\b[a-zA-Z][\w-]*-\[[^\]\s]+\](?!:)/g;

const files = globSync("{app,components,lib}/**/*.{ts,tsx}", { cwd: root });

let violations = 0;
for (const relPath of files) {
  const filePath = path.join(root, relPath);
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  lines.forEach((line, i) => {
    const matches = line.match(ARBITRARY_VALUE_RE);
    if (matches) {
      for (const m of matches) {
        console.error(`${relPath}:${i + 1}: arbitrary Tailwind value "${m}" — use a design token instead`);
        violations++;
      }
    }
  });
}

if (violations > 0) {
  console.error(`\n${violations} arbitrary Tailwind value(s) found. Add the size/color to tailwind.config.ts instead.`);
  process.exit(1);
}

console.log(`OK — no arbitrary Tailwind values across ${files.length} files.`);
