export * from "./money";

/**
 * OpenAPI-generated Zod schemas (Phase 0 non-negotiable rule: frontend
 * validation must be generated from the backend's OpenAPI spec, not
 * hand-written, so the two cannot drift) deliberately do NOT live here.
 *
 * They're generated into apps/web/lib/api/generated/client.ts instead —
 * apps/web is the only consumer of apps/api today (no second frontend
 * package exists in this workspace), and packages/shared must not import
 * from an app (that would invert the normal packages-are-depended-on-by-apps
 * direction; if it did, packages/shared would need to depend on
 * apps/api/openapi.json living at a fixed relative path from inside an app,
 * which is backwards). Re-exporting here would mean either that inversion,
 * or physically relocating the generated file into this package for no
 * present benefit. See docs/DECISIONS.md's "OpenAPI-generated client"
 * entry. If a second consumer of apps/api's schemas is ever added, revisit
 * moving generation here then — not preemptively.
 */
export {};
