# Architecture Decisions

One entry per non-obvious choice: what we decided, why, and what we rejected.

---

## 2026-08-19 — Design-MCP imports land in `design-reference/`, not in the app

**Decision:** High-fidelity screens produced via the Claude Design MCP (`.dc.html` + its `support.js` runtime) are checked into `design-reference/` at the repo root, verbatim, and are never imported into `apps/web`. The first two: `design-reference/debt-book-stock-room.dc.html` (Debt Book & Stock Room, source: claude.ai/design project `4e61e076-faec-43cf-ae49-2e8130fdd308`).

**Why:** `OperatorOS-Spec.md` designates `prototype.html` as the tie-breaker for anything Part B under-specifies (spacing, exact delta-chip colours, chart line styling, etc.). That file does exist at the repo root and covers the Shutter, Tally Rail, Counter, and Back Office → Analytics — but it only stubs Stock Room and Debt Book. These `.dc.html` files fill that specific gap: they are genuinely interactive (React-backed, with real click handlers, drawer state, a working stock-take counting flow), carry realistic Kigali-hardware-store data, and were verified end-to-end with Playwright (8-screen click-through, zero console/page errors) rather than just opened and eyeballed.

They are explicitly **not** production code:
- The `.dc.html` template DSL (`sc-for`, `sc-if`, `{{ }}` bindings) and its `DCLogic` class are a Claude-Design-specific authoring format, not React/Next.js.
- `support.js` pulls React, ReactDOM, and Babel from `unpkg.com` at runtime — acceptable for a locally-opened design reference, never acceptable in the shipped app (no runtime CDN dependencies, strict CSP, no `unsafe-inline` per spec G.1).
- All data is hardcoded in the script block (`PRODUCTS`, `CUSTOMERS`, `STATEMENTS`, …) — there is no backend, no ledger, no auth.

**Alternatives rejected:**
- *Port the `.dc.html` markup directly into React components.* Rejected — the markup is inline-styled HTML strings targeting the DCLogic runtime's template compiler, not idiomatic React/Tailwind; porting it would fight the actual component architecture (Radix primitives, the token-only Tailwind config, `<Money>`/`<Qty>`) rather than inform it.
- *Build Debt Book and Stock Room as real, ledger-backed screens now, since a working design exists.* Rejected — both rooms require the event ledger (Part E) and their own approved plans first, per the working agreement ("plan before you build") and the spec's own build sequence (H): Stock Room is Phase 1, Debt Book is Phase 2. Phase 0, in progress, is foundations only. Jumping ahead here would mean writing sale/stock/payment logic before the ledger exists — exactly what the ledger-first rule in the engineering brief forbids.

**How to apply:** When Stock Room (Phase 1) and Debt Book (Phase 2) plans are written, treat `design-reference/debt-book-stock-room.dc.html` the same way `prototype.html` is used elsewhere in the spec — open it, match its visual and interaction detail wherever the written spec underspecifies something, and cite it in the plan. Do not copy its markup or its `DCLogic` class. Any further Design MCP screens (Cash Box, Suppliers, Team) should land the same way: verbatim into `design-reference/`, verified with a real click-through before being trusted as a reference, and logged here.
