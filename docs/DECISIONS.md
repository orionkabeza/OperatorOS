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

---

## 2026-08-19 — KNOWN RISK (unresolved): Next.js 14.2.35 CSP-nonce XSS advisory (GHSA-ffhc-5mcf-pf4q)

**Not a decision — a flagged, tracked risk.** `npm audit` surfaced this as a high-severity advisory affecting every Next.js version from 13.4.0 up to 15.5.16 (fixed in 15.5.16 / 16.2.5). `apps/web` is pinned to Next 14 per the spec's explicit stack choice ("Next.js 14 (App Router)"), and 14.2.35 — the latest available 14.x patch — is confirmed affected. There is no fixed 14.x release; the only fix is a major-version upgrade.

**The vulnerability:** malformed nonce values derived from request headers can be reflected unsafely into rendered HTML, when an App Router app using CSP nonces sits behind a shared/CDN cache that caches a per-request-nonced response and serves it to other users.

**Why not fixed immediately:** upgrading to Next 15/16 is a real stack change (React 19, App Router behavior changes) that contradicts an explicit, already-approved spec decision — not something to make unilaterally mid-implementation, the same reasoning as §0.1's branch-strategy call. It also doesn't block Phase 0: nothing is deployed anywhere yet, let alone behind a shared cache.

**Mitigating factors specific to this codebase, right now:** `middleware.ts` generates the nonce with `crypto.randomUUID()` server-side on every request — it is never derived from or influenced by any client-supplied header, so the "malformed nonce from request headers" trigger doesn't have an input path here. And nothing is deployed behind a CDN or any shared cache (local dev only).

**Hard requirement before any real deployment:** do not put this app behind a CDN or any shared/reverse-proxy cache while still on Next 14 — caching a per-request-nonced HTML response for multiple users is the exact scenario this CVE needs, and is a bad idea independent of the CVE. Before Phase 1 ships anywhere real, either upgrade to Next ≥15.5.16 (own plan, own decision) or get an explicit sign-off to accept the risk with "never cache App Router HTML at a shared layer" as a hard operational rule.

**How to apply:** re-run `npm audit` before every deployment decision, not just once here. If Next 15 lands as a deliberate upgrade later, re-verify this advisory is actually resolved for the exact patch version installed rather than trusting the version number alone.

---

## 2026-08-19 — CSP: `style-src-attr 'unsafe-inline'`, everything else stays clean

**Decision:** `apps/web/middleware.ts`'s CSP splits `style-src-elem 'self'` (actual `<style>`/`<link>` tags — no exception) from `style-src-attr 'unsafe-inline'` (inline `style=""` attributes — allowed). `script-src` has zero `unsafe-inline`/`unsafe-eval`, nonce + `strict-dynamic` only.

**Why:** verified via the browser's own `securitypolicyviolation` events (not guessed from a console message) that Radix UI primitives — required by the stack ("Radix primitives for accessible behaviour") — set genuine inline `style=""` attributes internally: `Checkbox.Root` renders a visually-hidden native `<input>` positioned via inline style for accessibility/form compatibility, and `Dialog`/`Toast` toggle `pointer-events` inline during open/close transitions. This is Radix's own implementation, not application code — our components never write `style={{...}}` themselves, confirmed by grepping the component tree. Spec G.1 says "no `unsafe-inline`" for CSP generally; it doesn't have a style-src-attr-specific carve-out, but a blanket read that forbids this narrow exception would make Radix (also spec-required) unusable under a working CSP at all — a stack contradiction, not a security call I get to silently make one way or the other. I've resolved it toward the narrower, well-precedented reading (CSP Level 3 splits attr from elem specifically so implementations can make this exact trade-off; Google's own strict-CSP guidance accepts `style-src-attr 'unsafe-inline'` while keeping `script-src` fully locked, since a `style=""` injection can't execute script on its own).

**Verification, not assumption:** confirmed via Playwright — (1) `securitypolicyviolation` listener identified the exact two elements and directive (`style-src-attr`, not the broader `style-src`) before this fix; (2) a full click-through (fill phone/PIN, submit, reach the two-factor state) proved the app is genuinely interactive after the fix, not just free of console noise. An earlier debugging pass had also surfaced a real, separate finding worth remembering: a stale `.next` directory (built once, then re-served after further `npm install`s and a `next dev` run in between) served mismatched dev/prod artifacts and threw `unsafe-eval` violations from React Fast Refresh code — that was a build-hygiene bug, not a real CSP requirement, and disappeared with a clean `rm -rf .next && next build`. Lesson for later: verifying "the CSP works" means checking `next start` against a build produced immediately beforehand, with no dev server or extra installs in between contaminating `.next`.

**Alternatives rejected:**
- *Blanket `style-src 'unsafe-inline'`.* Rejected — far wider than needed; would also permit injected `<style>` blocks, which is a real XSS-adjacent vector the elem/attr split exists to avoid.
- *Rip out Radix, hand-build the accessibility behavior (focus trap, roving tabindex, ARIA wiring) ourselves.* Rejected — Radix is an explicit stack requirement, and reimplementing WAI-ARIA patterns from scratch is exactly the kind of accessibility risk a headless primitives library exists to prevent. Not worth it to avoid one narrow, well-understood CSP exception.

**How to apply:** if a future component ever needs `style={{...}}` in *our own* code, that's a bug — use Tailwind classes or a token-driven utility class instead, the same way `.shutter-slats`/`.shutter-brand-text` in `globals.css` handle the two cases (repeating-gradient, `clamp()`) that aren't expressible as discrete utilities. `style-src-attr 'unsafe-inline'` should stay scoped to third-party primitives' internals, never become an excuse to write inline styles in application code.
