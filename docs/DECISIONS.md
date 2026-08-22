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

---

## 2026-08-20 — `businesses` has no RLS; login resolves the tenant from a slug first

**Decision:** Every tenant table gets `ENABLE`+`FORCE ROW LEVEL SECURITY` bound to the `app.business_id` session GUC — except `businesses` itself, which has no RLS policy at all. Login (and refresh) require an explicit `business_slug`/`business_id` in the request; the API resolves that to a real business *before* any tenant-scoped query runs, using a plain, RLS-free `SELECT ... FROM businesses WHERE slug = :slug`.

**Why:** RLS needs `app.business_id` set before it can permit anything — but resolving *which* business a login belongs to is definitionally a pre-auth, cross-tenant-by-necessity operation: the caller doesn't have a verified tenant id yet, that's the whole point of the query. Spec D.1 assumes this is normally solved by subdomain routing ("the business name, if the subdomain or last-used tenant is known..."), which Phase 0 has no frontend host for yet, so the API takes an explicit slug in its place — same resolution, different transport. The alternative — giving the app role `BYPASSRLS` or a superuser-ish path for this one query — would have reintroduced exactly the class of bug RLS exists to prevent, just narrowed to one query. Treating `businesses` as the one non-tenant-owned table (it holds tenant *roots*, not tenant *data* — a business's own name/slug/currency isn't something one tenant could see and thereby learn something about another tenant's actual business data) keeps every other table's story simple: RLS, no exceptions, no bypass role anywhere in the system.

**Alternatives rejected:**
- *A global cross-tenant identifier lookup at login* (phone/email unique across all businesses). Rejected — real multi-tenant SaaS with per-shop subdomains doesn't work this way, and it would mean two different businesses could never have a staff member with the same phone number, which is unrealistic for shared family phones common in this market.
- *A `BYPASSRLS` or superuser connection just for the slug-resolution query.* Rejected — a second privilege tier is a second thing to get right and a second thing to audit; not worth it for a query that only ever returns a business's already-public-ish routing fields (id/slug/name/status/currency), never another tenant's operational data.

**How to apply:** When real subdomain routing lands (a later phase), swap the explicit `business_slug` request field for a `Host`-header lookup in the same `tenancy_resolution.py` function — the RLS-exemption reasoning for `businesses` doesn't change, only where the slug comes from.

---

## 2026-08-20 — Idempotency store is Postgres, not Redis; no explicit locking needed

**Decision:** `Idempotency-Key` handling (`idempotency_service.py`) claims a key via `INSERT INTO idempotency_keys ... ON CONFLICT (business_id, key) DO NOTHING`, in the *same transaction* as the business writes the endpoint performs, rather than a separate Redis-backed store.

**Why:** Spec G.1 leaves the store choice open ("Redis or a Postgres table, your call"). Postgres was chosen specifically so the idempotency claim, the event append, and the projection update all commit or roll back together — a failed request never leaves an orphaned "claimed" key with no corresponding effect. It also turns out to need zero extra locking code: Postgres's own `INSERT ... ON CONFLICT` blocks a second, concurrently-conflicting insert until the first transaction resolves (commits or rolls back), and only then re-checks the conflict — so two concurrent requests with the same key naturally serialize, and the loser sees a *fully completed* row the instant it unblocks, never a half-written one. `tests/test_idempotency.py::test_concurrent_duplicate_requests_write_exactly_one_event` fires the identical request twice with `asyncio.gather` and asserts exactly one event was written and both responses are byte-identical — proof this holds, not just an assertion that it should.

**Alternatives rejected:**
- *Redis with `SET NX` + a TTL.* Rejected — would need a second mechanism to keep the idempotency record and the business write atomic with each other (a distributed-transaction problem Postgres's own MVCC solves for free when both live in the same database).
- *An explicit `SELECT ... FOR UPDATE` polling loop for the "losing" concurrent request.* Rejected as unnecessary — the blocking-insert behaviour above already provides synchronization equivalent to a lock, with no polling.

**How to apply:** If idempotency keys ever need to survive a database restore/PITR gap shorter than their 24h TTL independent of the business data they guard, or need to scale write throughput past what one Postgres table can take, revisit Redis — but that hasn't been the constraint so far.

---

## 2026-08-20 — Projection write protection: a DB trigger + GUC marker, not a second DB role

**Decision:** `money_location_balance` (and any future projection table) is protected by a Postgres trigger, `reject_direct_projection_write()`, that raises unless the session GUC `app.projection_writer` is exactly `'true'` — a flag `projections/framework.py::apply_projections` sets immediately before calling projection handlers and clears immediately after, all inside the same transaction as the event append. The ordinary `operatoros_app` role has full `GRANT`s on the table; the trigger, not a privilege difference, is what stops a direct write.

**Why:** The API and the projection framework run as the *same* database role in the *same* process — there's no natural "projection-writing connection" distinct from "the app's connection" to hang a `GRANT`-based restriction off. A session-local marker that's only ever true for the few statements inside `apply_projections()` gives the same guarantee (nothing outside that narrow window can write) without a second connection pool, a second role, or any change to how the app connects to Postgres. `tests/test_projection_trigger.py` proves this by issuing a raw `UPDATE`/`INSERT`/`DELETE` against the table from a normal tenant-scoped session — outside that window — and asserting the trigger rejects it, then proves the framework's own path still works.

**Alternatives rejected:**
- *A second, narrower DB role (e.g. `operatoros_projector`) with the only grant on projection tables, used via a separate connection just for `apply_projections`.* Rejected — a second connection pool inside the same request/transaction defeats "same transaction as the event append," which is the actual requirement (spec E.3); two connections can't share one Postgres transaction.
- *`REVOKE UPDATE` from `operatoros_app` entirely and have the projection framework issue writes as the table owner.* Rejected for the same reason as above, plus it still doesn't stop the *app's own* accidental direct write from a future feature's code, which is exactly the mistake this control exists to catch.

**How to apply:** Any new projection table follows the same pattern: create it in a migration, add the same trigger (or reuse the shared trigger function — it already reads `TG_TABLE_NAME` generically), and only ever write to it from inside `apply_projections()`.

---

## 2026-08-20 — Tests run against a real, embedded Postgres (`pgserver`), not Docker

**Decision:** `tests/conftest.py` starts a genuine Postgres 16 server per test session using the pip-installed `pgserver` package (a real Postgres binary distributed as a platform wheel), runs every Alembic migration against it, and creates the same `operatoros_app` non-superuser role the real deployment uses. CI's `backend` job needs no `services: postgres:` block at all. Redis-dependent code runs against `fakeredis`, an in-memory server implementing the same command surface.

**Why:** RLS policies, the projection-write trigger, and the idempotency race are all genuinely Postgres-specific behaviours — mocking the database would prove nothing about any of them, and the whole point of Phase 0 is proving these controls actually hold. `pgserver` gives a real Postgres 16 with zero external dependencies (no Docker daemon, no `services:` container, no network dependency on a container registry), which turned out to matter concretely: this environment's sandbox blocks arbitrary binary-download CDNs (a `winget install postgresql` attempt failed with a 403), but PyPI itself is reachable, and `pgserver` ships its Postgres binary as a normal wheel. The same property makes CI faster (no container pull/health-check wait) and makes the suite runnable on a contributor's machine with nothing but `pip install`.

**Alternatives rejected:**
- *`docker compose up postgres` in CI and locally for tests.* Rejected as the default test path — still fully supported for running the *app* itself (`infra/docker-compose.yml` targets real `postgres:16`/`redis:7` images), but not required just to run `pytest`.
- *Mock/stub the database layer.* Rejected outright — RLS, triggers, and the `INSERT ... ON CONFLICT` blocking behaviour the idempotency design relies on are not things a mock can meaningfully stand in for.

**How to apply:** If a future test needs a Postgres version-specific behaviour not in 16, or the project needs a different major version in production, `pgserver`'s pinned version needs to move in lockstep with `infra/docker-compose.yml`'s `postgres:16` image tag.

---

## 2026-08-20 — `audit_log` is a separate table from `events`, not a view over it

**Decision:** The tamper-evident, hash-chained security audit log (`audit_log` table, `operatoros_api/audit_log.py`) is a distinct table from the event ledger (`events`), not a filtered view or a repurposing of the same storage.

**Why:** The two serve different jobs and have different integrity requirements. `events` (spec E.2/E.3) is the *business* system of record: append-only by convention and by the API surface (`ledger.append_event`), replayable to rebuild any projection, partitioned by month for the volume of a real trading business's day-to-day activity (sales, stock movements, payments — potentially thousands of rows a day per tenant). `audit_log` (spec G.1 "Auditing") is the *security* record: authentication and authorization events specifically (logins, role changes, permission overrides, exports), append-only *and* cryptographically chained so that even a direct out-of-band database edit — bypassing the application entirely, e.g. an admin with elevated access during an incident — is detectable by re-walking the chain and finding where a hash no longer matches its row's content. `events` has no such chain: its append-only-ness is enforced by the application's API surface and the `operatoros_app` role's grants (`SELECT, INSERT`, no `UPDATE`/`DELETE`), which is the right level of protection for business data whose primary threat model is "a feature bug tries to mutate history," not "an attacker with database access tries to cover their tracks." Building the hash chain into every `events` row would add real per-write cost (an advisory lock + a hash computation on every business event) for a guarantee the business ledger doesn't need, and would blur two different audiences: `events` answers "what happened in the business," `audit_log` answers "who did the security-sensitive things, and can I trust this record."

**Alternatives rejected:**
- *One event type namespace, with `LOGIN_SUCCEEDED` etc. treated as ordinary ledger events and `audit_log` implemented as a filtered view.* Rejected — a view can't add the hash chain retroactively (chaining requires control over the insert path and a serialization point per business, not just a read-time filter), and it would force every ledger write through the audit-log's advisory-lock serialization even when nothing security-relevant happened.
- *Hash-chain the entire `events` table.* Rejected as disproportionate: the events table's threat model (spec E.1: "nothing is deleted, everything is a reversing/correcting event") is about accidental or buggy mutation from within the app, which append-only privileges already address; the audit log's threat model (G.1) is explicitly about detecting tampering that happens *outside* normal application privilege, which needs the stronger, more expensive guarantee.

**How to apply:** A future event type that is *both* a business event and security-relevant (e.g. a large cash `EXPENSE_RECORDED` that should also be flagged for the owner) gets recorded once in `events` (the business fact) and, if it's the kind of thing that belongs in a tamper-evident trail, a corresponding `append_audit_log(...)` call alongside it — same pattern as `auth.py`'s login handlers, which write both a `LoginAttempt` row (operational: powers lockout) and an `audit_log` entry (security record) for the same login.

---

## 2026-08-20 — Cross-tenant isolation suite: verified with a deliberate break, not just a passing run

**Decision:** Before considering `tests/test_cross_tenant_isolation.py` done, migration `0001_tenancy_and_rls.py` was temporarily edited to skip `ENABLE`/`FORCE ROW LEVEL SECURITY`/the policy for the `users` table (keeping its normal `GRANT` so the app kept functioning), the full isolation suite was run against that broken state, and the failure was recorded before reverting.

**Why:** A cross-tenant test suite that has never been observed to fail is not proven to test anything — it could be vacuously passing because of a bug in its own route-discovery logic (which did in fact happen once during development: this FastAPI version represents `include_router(...)` as a lazy `_IncludedRouter` wrapper rather than flattening routes into `app.routes` immediately, so a naive `isinstance(route, APIRoute)` filter silently found zero protected routes and the suite passed doing nothing — caught by a dedicated `test_at_least_one_protected_route_is_discovered` sanity check, not by the isolation assertions themselves). Deliberately breaking the control under test and confirming the suite reacts is the only way to be sure the "it passes" signal means what it claims to mean.

**Transcript (abbreviated, full command output in the PR/task report):**
```
# users' RLS ENABLE/FORCE/POLICY commented out in migration 0001 (GRANT kept)
$ python -m pytest tests/test_cross_tenant_isolation.py -q
...F
AssertionError: Cross-tenant isolation FAILED:
  GET /api/v1/users/<tenant-B-user-id> returned unexpected status 500:
  {"detail":"Something went wrong on our end. Please try again."}
1 failed, 2 passed

# migration reverted
$ python -m pytest tests/test_cross_tenant_isolation.py tests/test_rls_isolation.py -q
.......
7 passed
```
(The break surfaced as a 500 rather than a clean "200 with tenant B's data" 200 — disabling RLS on `users` let the row load, but `roles` still had RLS enabled and the `role` relationship failed to resolve for a cross-tenant row, which is itself a small demonstration of RLS's defense-in-depth: even a *partially* broken configuration didn't produce a clean leak. Either way, the suite's job is to fail on the break and pass once fixed, and it did both.)

**How to apply:** Any change to `TENANT_TABLES` in `alembic/versions/0001_tenancy_and_rls.py`, or to how `app.business_id` is set (`db.py::tenant_scoped_session`), should be re-verified the same way — comment out the table's RLS block, confirm the isolation suite fails, revert, confirm it passes again — before trusting the change.

---

## 2026-08-20 — `permissions` is replicated per business, not a single global catalogue

**Decision:** The `permissions` table (the capability catalogue — `sale.create`, `product.view_cost`, etc.) carries `business_id` and is seeded identically for every business at creation time (`operatoros_api/seed.py::seed_default_roles_and_permissions`), rather than being one global, business_id-less reference table.

**Why:** The approved plan's table list for tenancy (`businesses, locations, users, roles, permissions, role_permissions, user_locations, user_grants, device_sessions, refresh_tokens, login_attempts`) states plainly that *every one of these gets `business_id` except `businesses`* — `permissions` is explicitly on that list. Treating it as a second RLS-exempt "system" table (alongside `businesses`) would have been a reasonable design on its own merits, but it would introduce a second kind of exception to "RLS, no exceptions" for no real benefit at this stage: the capability catalogue is small (~20 rows), cheap to duplicate per tenant, and keeping every auth-adjacent table under the exact same RLS story (`ENABLE`+`FORCE`+policy+scoped `GRANT`) removes one more place a future contributor has to remember a special case exists.

**Alternatives rejected:**
- *A single global `permissions` table, RLS-exempt like `businesses`.* Rejected — technically defensible (capability keys don't vary per tenant in Phase 0), but it adds a second RLS exception for a savings of ~20 duplicated rows per business, which isn't worth the inconsistency.

**How to apply:** If a future phase needs genuinely tenant-customisable capabilities (a business defining its own capability beyond the fixed catalogue), the per-business `permissions` rows are already the right shape for that — no schema change needed, just relaxing `seed_default_roles_and_permissions` to allow additions after the initial seed.

---

## 2026-08-20 — No-float-money gate: verified with a deliberate violation, not just written

**Decision:** Before trusting `scripts/check_no_float_money.py` as a real CI gate, a temporary file (`apps/api/src/operatoros_api/_deliberately_broken_money_demo.py`) with three intentional violations — a `float`-returning function named like a money accessor, a `float`-annotated `unit_price`, and a `float` literal assigned to `expense_amount` — was added, the script was run and shown to exit `1` with all three flagged, the file was deleted, and the script was run again and shown to exit `0`.

**Transcript:**
```
$ python scripts/check_no_float_money.py
no-float-money gate FAILED:
  src\operatoros_api\_deliberately_broken_money_demo.py:5: function 'compute_total_price' returns float but looks like a money accessor
  src\operatoros_api\_deliberately_broken_money_demo.py:10: 'expense_amount' is assigned a float literal (4999.99)
  src\operatoros_api\_deliberately_broken_money_demo.py:6: 'unit_price' is annotated float but looks like money
3 violation(s). Money must be an int of minor units ...
[exit code 1]

# file deleted

$ python scripts/check_no_float_money.py
no-float-money gate: OK
[exit code 0]
```

**Why:** Same reasoning as the cross-tenant isolation suite's before/after proof above — a gate that has only ever been observed passing hasn't demonstrated it can fail. `tests/test_no_float_money.py` keeps a permanent, safe version of this same proof (against synthetic in-memory source, so no deliberately-broken file needs to live in the repo), but the one-time real-file demonstration is recorded here since a unit test of the detector's logic isn't quite the same claim as "this actually fails a real build."

**How to apply:** Re-run the same demonstration if `check_no_float_money.py`'s detection logic changes materially (not just an addition to the money-name regex) before trusting it again.

---

## 2026-08-20 — TOTP secrets: one deployment-wide encryption key for now, not per-tenant envelope encryption

**Decision:** `security/crypto.py` encrypts small at-rest secrets (currently only TOTP seeds; mobile-money/EBM credentials will use the same interface once those exist) with a single Fernet key read from settings, rather than the per-tenant data keys spec G.1 describes ("Mobile-money and EBM credentials encrypted at rest with envelope encryption, per-tenant data keys, decrypted only in the request path that needs them. Key rotation supported.").

**Why:** Phase 0 has exactly one secret type that needs this (TOTP seeds), no key-management service integration yet, and no feature that would exercise per-tenant key rotation. Building the full envelope-encryption story (a KMS or equivalent, per-tenant data-encryption keys wrapped by a master key, rotation tooling) now would be speculative — there's nothing yet to prove it against. `encrypt_secret`/`decrypt_secret` are already the seam a later phase swaps the implementation behind without touching any caller (`auth.py`'s TOTP handling, the only current caller, doesn't know or care how the secret is encrypted).

**Alternatives rejected:**
- *Build the full envelope-encryption scheme now.* Rejected as premature for a single, low-value-if-compromised secret type (a TOTP seed, not a payment credential) with no per-tenant rotation requirement driving it yet.
- *Store TOTP secrets in plaintext, relying on the database's own encryption-at-rest.* Rejected outright — G.1's baseline (encryption at rest, PII minimised) is a floor, not a target, and application-layer encryption of a second-factor seed is cheap insurance against a database-level compromise specifically.

**How to apply:** When mobile-money or EBM credentials are added (Phase 2/5), that's the forcing function to build real per-tenant envelope encryption — `encrypt_secret`/`decrypt_secret`'s call sites don't need to change, only their implementation and `Settings.secret_encryption_key`'s replacement with a per-tenant key lookup.

---

## 2026-08-20 — Phase 1: projection tables split from their entity tables wherever a table needs both direct and event-driven writes

**Decision:** `customer_balance` is its own table (`customer_balances`, models/customers.py), not columns on `customers`. `product_stock` (`product_locations`, models/catalog.py) and the D.5.3 stock ledger (`stock_movements`, models/stock.py) get the full `reject_direct_projection_write()` trigger because — unlike customers — literally every write to them originates from a stock-affecting event; there is no direct-CRUD path into either table at all.

**Why:** `customers` needs ordinary direct-write CRUD (name/phone/terms/status edits) because there is no `CUSTOMER_UPDATED` event in the fixed Phase 0 registry for a simple profile edit — only `CUSTOMER_CREATED` and `CREDIT_LIMIT_CHANGED` exist, and adding a new event type was out of scope this phase. Putting `balance_minor`/`credit_limit_minor` on the same table as those direct writes would force a choice between (a) the trigger blocking ordinary profile edits, or (b) leaving money-shaped state on that table unprotected — neither is acceptable given Phase 0's established invariant ("only the projection framework writes projection tables," docs/DECISIONS.md 2026-08-20 "Projection write protection"). Splitting the table is what keeps that invariant true with zero carve-outs.

**How to apply:** Any future table that needs both directly-writable fields and event-derived money/quantity fields should be split the same way, not merged with a trigger exception.

---

## 2026-08-20 — Phase 1: two payload/plan mismatches resolved without touching the fixed event registry

**Decision:** Two places where plan §2's projection description didn't quite fit the actual (fixed, Phase 0) `events_registry.py` payload shape, resolved by changing *how the events are used*, not the payload schemas:

1. `STOCKTAKE_POSTED`'s payload (`stocktake_id, location_id, variance_value_minor, line_count`) has no per-product quantities, so it cannot itself drive `product_stock`. Posting a stock-take instead appends one `STOCK_ADJUSTED` event per line with a non-zero variance (which *does* drive `product_stock` through the handler every other adjustment uses) plus one `STOCKTAKE_POSTED` summary event for the audit trail. No `product_stock` handler is registered for `STOCKTAKE_POSTED` itself — see projections/product_stock.py's module docstring.
2. `RETURN_RECORDED`'s payload has no per-line restock flag and no `customer_id` field. `api/routers/sales.py`'s return endpoint puts only the caller-marked-restock lines into the event's `lines` array (damaged lines instead get their own `STOCK_WRITTEN_OFF` event each, matching spec D.4's stated behaviour exactly); `projections/customer_balance.py`'s handler resolves the customer via the original `Sale` row's `customer_id` rather than the event payload.

**Why:** The task brief was explicit that adding new event types or payload fields is out of scope this phase — Phase 0's registry is the fixed contract. Both mismatches are resolved by treating the *action* (posting a stock-take; recording a return) as something that legitimately emits more than one event, which the ledger already supports (spec E.1 has no "one event per action" rule) — not by inventing new payload shapes.

**How to apply:** If a future phase needs `STOCKTAKE_POSTED` or `RETURN_RECORDED` to carry more structured data directly, that's the point to revisit the registry — flagged here as the honest reason this wasn't done now, not silently worked around.

---

## 2026-08-20 — Phase 1: "cash" payments post to the `till` money-location account, not a separate `cash` account

**Decision:** `projections/money_location_balance.py`'s `SALE_RECORDED` handler maps payment method `"cash"` to `account_key = "till"`; every other method (`momo`, `airtel`, `bank`, `card`, `cheque`) keeps its own name as its own account.

**Why:** Spec D.7.1's balances band names the physical cash account "TILL" (`TILL — RWF 340,500`), the same account `DAY_OPENED`/`DAY_CLOSED` reconciles against a physical count. A first pass of this handler used the payment method string directly as the account key, which would have created a same-money-different-name split between "cash sales" and "till count" — caught before shipping by writing the day-close test and finding the numbers didn't line up.

**How to apply:** Any new payment method that should be its own D.7.1-style balances-band card gets its own account_key; anything that's physically "the cash in the drawer" maps to `"till"`.

---

## 2026-08-20 — Phase 1: DAY_OPENED/DAY_CLOSED SET the till balance rather than adjusting it by a delta

**Decision:** `money_location_balance`'s handlers for `DAY_OPENED`/`DAY_CLOSED` assign `balance_minor = counted_amount_minor` directly (an overwrite), unlike every other handler in the file, which only ever adds/subtracts a delta.

**Why:** The whole point of the open/close ritual (spec D.3/D.11) is that a human physically counted real cash and that figure is authoritative over whatever the ledger's running total believes — the same reasoning a bank reconciliation corrects *to* the statement rather than adjusting the statement by a computed delta. Treating it as a correction-to-truth rather than a delta also means any untracked cash movement (a float taken overnight, a miscount) never compounds past one business day — it gets zeroed out at the next physical count.

**How to apply:** Any future "a human counted the real number" event (e.g. a till-session close, if it's ever wired into `money_location_balance` too) should follow the same SET-not-delta pattern, not the ADD pattern most of this file uses.

---

## 2026-08-20 — Phase 1: `daily_totals`/`staff_daily_totals`/`product_daily_movement` key on the open DaySession's business_date, not UTC calendar date

**Decision:** `projections/daily_totals.py` resolves the date to key these three projections on by looking up the currently-OPEN `DaySession` for the event's `(business_id, location_id)`, not `event.occurred_at`'s UTC calendar date. If no open day session exists, the handler raises rather than guessing — this is a real invariant violation (the day must be open for a sale to be recorded at all) and should fail loudly, not silently misfile a total.

**Why:** A shop's trading day is whatever `DAY_OPENED`/`DAY_CLOSED` says it is (spec D.3/D.11's own ritual) — not midnight UTC, which has no relationship to a Kigali shop's actual hours. This also means a day reopened for a late transaction (spec D.11: "Late transactions ... require the day to be reopened") is handled automatically: the reopened session's `status` flips back to `open`, so the same lookup finds it with no extra plumbing.

**How to apply:** Any future projection keyed on "which business day did this happen on" should use the same open-DaySession lookup, not `occurred_at`'s calendar date.

---

## 2026-08-20 — Phase 1: fixed 18%/0% VAT rate, sale-level discount applied post-line-tax, exact-payment-match, no hard till-session requirement

**Decision, four related simplifications in `api/routers/sales.py`, all disclosed rather than silently invented:**

1. **VAT** is a hard-coded `{"standard": 18%, "exempt": 0%}` keyed on `Product.tax_class` — there is no business-configurable tax-rate settings screen yet (spec D.10.6 Settings is out of Phase 1 scope).
2. **Sale-level `discount_minor`** (as opposed to per-line discounts) is subtracted from the subtotal after each line's own tax has already been computed on that line's pre-sale-discount net price — not redistributed proportionally across lines before tax. A fully accurate discount-before-tax allocation is deferred.
3. **`payments` must sum to exactly `total_minor`** — no over/under payment accepted by the API. "Change due" (spec D.4: cash given minus what's owed) is a client-side UI computation from a "cash given" figure the API never sees or stores this phase.
4. **A till session is looked up but not required** for `create_sale` to succeed (`Sale.till_session_id` is nullable) — only the day needs to be open. Spec D.7.5 describes till sessions as the norm, but making one a hard precondition for the MVP "sell a product" path was judged an unnecessary extra dependency; till reconciliation (`api/routers/till.py`) still works correctly whenever a till session IS open, and the tests exercise both with-and-without-till-session paths.

**Why:** All four are genuine Phase 1 MVP scope trims rather than ambiguity resolved by guessing — each is exactly the kind of thing that would be wrong to invent silently for a system handling real money, so each is documented at the point of decision (the same paragraph in `sales.py`'s module docstring) as well as here.

**How to apply:** VAT rates become business-configurable when Settings (D.10.6) lands; the discount/tax ordering should be revisited if margin-erosion reporting (D.10.3) needs to show discount and tax impact separately per line; over/under-payment support (rounding differences, tips, till float top-ups via a sale) would need an explicit product decision on where the difference goes, not just a schema relaxation.

---

## 2026-08-20 — Phase 1: stock-take "freeze during count" is a live query, not a stored flag — a real bug caught by tests

**Decision:** `ProductLocation.frozen` (added to the schema anticipating spec D.5.4's "freeze the counted items" option) is never written or read. Whether a product is frozen is instead answered by `api/routers/stock_stocktake.py::is_frozen_for_stocktake`, a live query for an open, freezing `Stocktake` covering that product/location, called from `sales.py`'s stock check.

**Why:** `product_locations` is protected by `reject_direct_projection_write()` — only `projections/product_stock.py` may write it. The first implementation wrote `loc_row.frozen = True` directly from the stock-take router, which is exactly the class of bug that trigger exists to catch: it raised `InsufficientPrivilegeError` and surfaced as a 500 the moment a test exercised the freeze path (`tests/test_stocktake_and_transfers.py::test_frozen_stocktake_blocks_a_sale_until_posted`, which failed before this fix and passes after). Deriving the frozen state from `Stocktake.status`/`freeze_during_count` instead needs no write to a projection table at all, and "unfreeze" falls out for free the moment the stock-take is posted (the query simply stops matching).

**How to apply:** The dead `frozen` column was left in place (documented in models/catalog.py) rather than spending a further migration to drop it — safe since it's never read or written, but a future cleanup pass could remove it. Any future "temporary state that blocks an action" idea involving a projection table should default to a live query against the table that actually owns that state, the same way, rather than adding a flag to the projection table.

---

## 2026-08-20 — Phase 1: XLSX import via openpyxl, no server-side import staging

**Decision:** CSV/XLSX product import (`product_import.py`, spec D.2 Step 3) uses `openpyxl` for XLSX parsing (added to `apps/api`'s runtime dependencies) and does NOT persist an in-progress import server-side between `/preview` and `/commit` — the client re-sends the (corrected) row set it got back from `/preview`.

**Why:** `openpyxl` is pure Python, never touches macro/VBA content (`load_workbook()` only ever reads the worksheet cell grid), and is the de facto standard for this exact job — `pandas` would also work but pulls in numpy and a much larger dependency surface for a straightforward row-by-row read. No staging table avoids a second expiring-token/cleanup-job story for what is, in practice, an onboarding-sized list (spec D.2's own UI shows "a preview of the first 20 rows") — the cost is the client needing to hold and re-send the full row set, judged acceptable for that size.

**Alternatives rejected:**
- *`pandas` + `openpyxl`/`xlrd` under the hood.* Rejected — meaningfully heavier dependency for no functional gain here.
- *A server-side staging table with an import token and TTL.* Rejected for now as more machinery than a first-cut import screen needs; revisit if a business's product list import turns out to be large enough that re-sending the full row set becomes a real problem.

**How to apply:** If a future need (e.g. imports in the thousands of rows, or a resumable import across sessions) makes the no-staging trade-off too costly, add a staging table keyed by an import id with a TTL, matching the idempotency-key table's own pattern (Postgres, not Redis, same reasoning as docs/DECISIONS.md's idempotency-store entry).

---

## 2026-08-20 — Phase 1: two Phase 0 packaging/test-infra gaps fixed in passing

**Decision:** Two issues unrelated to Phase 1 features, discovered while building and running Phase 1's own test suite, fixed rather than worked around:

1. `pgserver` (imported by `tests/conftest.py`, required to run the test suite at all) was missing from `pyproject.toml`'s `dev` dependency list — `pip install -e ".[dev]"`, the RUNBOOK's own documented setup command, could not actually run the suite without it. Added, along with `openpyxl` (needed for this phase's XLSX import).
2. `tests/conftest.py`'s embedded-Postgres fixture created a temp data directory (`tempfile.mkdtemp(prefix="operatoros_pg_")`) per test session and called `server.cleanup()` on teardown, but never deleted the directory itself — each real Postgres data directory left behind was tens of megabytes. Running this phase's test suite dozens of times over the course of the work left 56 such directories on disk and filled the machine's C: drive to 0 bytes free mid-task, which is what surfaced it. Fixed with an explicit `shutil.rmtree(tmp_dir, ignore_errors=True)` after `server.cleanup()`.

**Why:** Both are exactly the kind of small, unrelated-but-directly-blocking issues worth fixing in passing rather than leaving for someone else to hit blind — the first blocks anyone following the RUNBOOK from scratch, the second silently fills a contributor's or CI runner's disk over time.

**How to apply:** If `pgserver` or a future embedded-service test dependency changes its own cleanup behaviour, re-verify a full test run doesn't leave temp artifacts behind (`ls $TEMP | grep operatoros_pg` should be empty after `pytest` exits).

---

## 2026-08-20 — Phase 1: three new capability keys added to the existing catalogue (not new event types)

**Decision:** `customer.manage`, `return.create`, and `stocktake.post` were added to `capabilities.py`'s `CAPABILITIES`/`DEFAULT_ROLE_CAPABILITIES`, granted to Owner/Manager by default, plus Cashier for `return.create` and Storekeeper for `stocktake.post` (spec F.1's per-role table).

**Why:** `capabilities.py`'s own Phase 0 docstring already documents this as expected, cheap per-phase growth ("the exact bundle membership will be revisited as each phase's features land... a data change, not a mechanism change") — distinct from the events_registry.py event-type freeze the task brief called out explicitly. Customer profile edits/credit-limit changes, recording a return within the normal window, and posting a stock-take all needed a capability distinct from the closest Phase 0 analogues (`user.manage`, `sale.void`, `stock.adjust` respectively) to match spec F.1's actual role boundaries (e.g. a Cashier can process an ordinary return but not write off debt or override a credit limit).

**How to apply:** Same pattern for any future phase's new capability needs — add the key, describe it, assign it in `DEFAULT_ROLE_CAPABILITIES` per spec F.1's table, no schema/mechanism change required.

---

## 2026-08-20 — Phase 1 frontend: a hand-rolled mock adapter, not MSW

**Decision:** `apps/web/lib/mock/` (store.ts + seed.ts) is a plain in-memory module, not Mock Service Worker. Every `lib/api/*.ts` function branches on a single `USE_MOCK_API` constant (`lib/api/config.ts`) and calls either the mock store directly or a real `fetch` — never an intercepted network request.

**Why:** The task brief offered either MSW or "a simple fetch-intercepting dev-only adapter." MSW's browser mode needs a generated `mockServiceWorker.js` registered as a real Service Worker, which (a) is one more moving part to keep in sync with the strict, nonce-based CSP (service worker registration and its own fetch interception have their own CSP/scope implications not otherwise exercised by this app) and (b) would need `msw/node` wired up separately for Vitest and yet another config surface for Playwright, three integration points for one seam. The direct-branch adapter needs zero registration, works identically whether the code runs under Vitest (jsdom), Playwright (real Chromium), or `next dev`, and the swap point for the real backend is one file (`config.ts`'s `USE_MOCK_API`) — flip it and every already-written `apiRequest(...)` call path (present in every `lib/api/*.ts` function today, just unexercised) becomes live with no component changes. Same spirit as `lib/demo-auth-store.ts`'s Phase 0 precedent: temporary, clearly marked, swappable without touching callers.

**Alternatives rejected:**
- *MSW in browser + node mode.* Rejected — real value (byte-accurate network-layer interception, DevTools-visible requests) that this project doesn't need yet, since there's no real backend to contract-test against this phase; the cost (service worker + CSP interaction, two runtime configs) wasn't worth paying for that value now.

**How to apply:** When `apps/api` is live and reachable, set `NEXT_PUBLIC_API_BASE_URL` and `USE_MOCK_API` flips to `false` automatically (`!process.env.NEXT_PUBLIC_API_BASE_URL`) — no code changes elsewhere. If a future phase genuinely needs network-layer testing (e.g. verifying retry/timeout behaviour, or the `Idempotency-Key` header actually reaching the wire), that's the point to add MSW specifically for that test file, not replace this adapter wholesale.

---

## 2026-08-20 — Phase 1 frontend: real CSP violation from Radix's scroll-lock — fixed with a nonce, not a CSP weakening

**Decision:** `app/providers.tsx` now calls `setNonce()` from the `get-nonce` package (added as a direct dependency) with the same per-request nonce `middleware.ts` already generates for `script-src`, read off the existing `<meta name="x-nonce">` tag. `middleware.ts`'s CSP gained `style-src-elem 'self' 'nonce-${nonce}'` (previously `'self'` only).

**Why:** Adding `@radix-ui/react-dropdown-menu` and `@radix-ui/react-tabs` for the Counter/Stock Room screens surfaced a real, previously-latent bug: every Radix Dialog-family primitive (`Dialog`, `Menu`/`DropdownMenu`) depends on `react-remove-scroll` for body scroll-locking, which injects a genuine `<style>` element via `react-style-singleton` to hide the scrollbar and compensate its width — this has been true since Phase 0's `ConfirmDialog`/`Drawer` started using `@radix-ui/react-dialog`, but no Phase 0 test asserted zero console/CSP errors *after actually opening a Dialog* (the shutter/design smoke tests check the page shell, not an opened modal's after-effects). Confirmed via a `securitypolicyviolation` listener (same method as the Phase 0 CSP fix in this file) that the violated directive was `style-src-elem`, not `style-src-attr` — this is a real `<style>` tag, not an inline `style=""` attribute, so the existing `style-src-attr 'unsafe-inline'` carve-out doesn't and shouldn't cover it. `react-style-singleton` already supports exactly this scenario via `get-nonce`'s `setNonce()`; wiring the app's own per-request secret nonce through it keeps "no `unsafe-inline` anywhere" strictly true — an attacker still cannot inject an arbitrary `<style>` element without knowing that request's nonce, which is the same guarantee `script-src`'s nonce already provides.

**Alternatives rejected:**
- *Add `style-src-elem 'unsafe-inline'`.* Rejected — this is exactly the blanket weakening spec G.1 forbids and the whole nonce architecture exists to avoid; a nonce achieves the same functional outcome without it.
- *Disable Radix's scroll lock (`Dialog.Root`'s internals don't expose this directly without dropping to lower-level primitives) or replace Dialog-family components.* Rejected — scroll-locking behind a modal is correct, expected behaviour (spec-adjacent UX baseline), and Radix is an explicit stack requirement; the nonce fix is a two-line, non-invasive change instead.

**How to apply:** Any future Radix (or other) primitive that injects DOM nodes should be checked the same way before being trusted under this CSP — open it in a real browser (or Playwright) with a `securitypolicyviolation` listener attached, not just eyeballed. If a library's injected element doesn't support nonces, that's a real blocker requiring either a different library or an explicit, documented, scoped CSP exception — never a blanket `unsafe-inline`.

---

## 2026-08-20 — Phase 1 frontend: Counter's three-column layout only mounts one Basket at a time, keyed off the spec's own ≥1280px threshold

**Decision:** `lib/use-media-query.ts`'s `useIsDesktopBasket()` checks `(min-width: 1280px)` — spec D.4's literal "three columns on desktop (≥1280px)" — and `components/counter/Counter.tsx` conditionally mounts either the inline desktop `<Basket>` column or the mobile bottom-sheet `<Basket>` (bottom bar + Drawer), never both at once.

**Why:** The first implementation mounted both simultaneously, showing/hiding each with Tailwind's `hidden md:block` (768px) — CSS-only visibility, not conditional mounting — which created two real problems, both caught by driving the app with real Playwright automation rather than trusting the code by inspection: (1) two DOM nodes shared the same `aria-label="Basket"` landmark simultaneously (one merely `display:none`, not absent — a genuine duplicate-landmark defect, not just a test-locator inconvenience), and (2) at exactly 768px width the fixed 420px basket column plus the category rail left the product grid roughly 50px of usable width, which `<main>`'s `overflow-x-hidden` then clipped to invisible — the product tiles were technically in the DOM but had zero effective rendered size. Both problems trace to the same root cause: reserving desktop-column space starting at the wrong breakpoint (768px, tablet) instead of the spec's own stated one (1280px, desktop). Real conditional mounting via `useMediaQuery` (not CSS `hidden`) fixes both at once and is architecturally more honest — there was never a reason to run two live, data-fetching copies of the same stateful basket simultaneously.

**How to apply:** Any future screen with a similar "column on desktop, sheet on mobile" pattern should use real conditional mounting (a media-query hook) rather than CSS-only `hidden`/`block` toggling, specifically because duplicate ARIA landmarks and viewport-squeeze layout bugs are easy to miss by code review alone and only reliably surface under real browser automation at the actual breakpoint boundary.

---

## 2026-08-20 — Phase 1 frontend: `Money`'s `emphasis` prop, `forwards` on three animations, and a `text-white/70` contrast fix

**Decision:** Three small, real fixes to Phase 0 design-system code, all found via genuine browser/axe verification while building Phase 1 screens, not by inspection:
1. `components/design/Money.tsx` gained an optional `emphasis?: "in" | "out" | "watch"` prop that forces the figure's colour independent of sign — needed for D.4's "shows the customer's outstanding balance inline... in `--out`," which is a *positive* receivable amount that still needs to read as a warning, not a negative one (which would incorrectly add a leading minus per B.3's rule).
2. `components/design/Qty.tsx`'s dark-surface unit suffix (e.g. "items" in the Tally Rail's "Low stock" figure) changed from `text-white/60` to `text-white/70` — axe measured 4.18:1 against `--steel`, under WCAG AA's 4.5:1 floor for normal text; `white/70` computes to ~6.9:1.
3. `tailwind.config.ts`'s `count-up`/`drawer-slide-in`/`row-fade-in` animations gained `forwards` (matching `shutter-raise`/`-lower`/`-fade`, which already had it) — explicit fill-mode rather than relying on the "to" keyframe coincidentally matching each element's un-animated resting style.

**Why:** Same standard as everything else in this file — a real axe scan on the Stock Room screen (where the Tally Rail's "Low stock" figure is live) is what caught #2, not a design review; #1 and #3 were found while building/testing the Counter and Close-the-Shop flows respectively.

**How to apply:** Any future screen needing to force a `Money` figure's colour independent of its sign should use `emphasis`, never fake it with a wrapping `className` (the figure's own inner span sets its colour directly, so an outer wrapper class doesn't reach it — confirmed the hard way).

---

## 2026-08-20 — Phase 1 frontend: known, accepted risk — `exceljs`'s pinned `uuid@8.3.2` (moderate, GHSA-w5hq-g745-h8pq)

**Not a decision — a flagged, tracked risk**, same pattern as this file's existing Next.js 14.2.35 CSP-nonce entry. `exceljs@4.4.0` (added for the D.2 Step 3 XLSX importer) pins `uuid@^8.3.0`, which resolves to `8.3.2` — flagged by `npm audit` as moderate severity (missing buffer bounds check in `uuid`'s v3/v5/v6 functions "when `buf` is provided"). No newer `exceljs` release exists that depends on a patched `uuid`.

**Why not fixed immediately:** An `npm overrides` pin to `uuid@^11.1.1` was tried and did not take — `npm install`, `npm install --force`, and removing the resolved `uuid` directory and reinstalling all left `exceljs` resolving `uuid@8.3.2` regardless (worth a fresh look with more time; not chased further here). A full `package-lock.json` regeneration was the next lever available, but this workspace's lockfile is shared with the backend agent's concurrent work in the same worktree, disk space in this sandbox was observed at 0 bytes free at least once during this session (see this file's Phase 1 backend `pgserver`-cleanup entry), and the vulnerable code path (`buf`-provided v3/v5/v6 UUID generation) is very unlikely to be reachable from this app's actual usage — `apps/web` only ever calls `workbook.xlsx.load(buffer)` to *read* a tenant-uploaded product list, never constructs or writes a workbook, and `exceljs`'s own use of `uuid` is plausibly confined to write-path features (defined names, styles) this app never exercises. Given that risk profile, forcing a same-session lockfile fight over a shared, disk-constrained worktree was judged the wrong trade against a moderate, likely-unreachable finding.

**How to apply:** Before shipping this importer anywhere real, re-attempt the `uuid` override (or an `exceljs` upgrade, if one ships) on a clean checkout with normal disk headroom, and confirm which `exceljs` code path actually invokes `uuid` — if it *is* reachable from `.load()`, this becomes a must-fix, not an accepted risk. `npm audit --omit=dev` is the one-line check.

---

## 2026-08-20 — Phase 1: closed a last-unit overselling race in the sale endpoint

**Decision:** `api/routers/sales.py::_check_stock`'s read of `ProductLocation` now takes `.with_for_update()`, and processes a sale's lines in a stable `product_id` order.

**Why:** found during independent re-verification before merging Phase 1, not by either building agent. The `product_stock` projection's actual decrement (`projections/product_stock.py::_get_or_create_locked`) already locked its row with `FOR UPDATE` — but `_check_stock`'s earlier read, in the same request transaction, did not. Two genuinely concurrent sales for the last unit of a product (two different Idempotency-Keys — e.g. two cashiers scanning the same last item at the same instant, not a retried request) could both read "1 available" before either commits, both pass the check, and the second to reach the projection would apply its decrement on top of the first's already-zeroed row, driving `on_hand` negative silently with no override recorded. Proved by temporarily reverting the lock and re-running the new regression test (`test_concurrent_sales_for_the_last_unit_do_not_oversell`): without the fix it produced two `201`s instead of one `201` and one `422`. The existing double-submit tests didn't catch this because they replay the *same* Idempotency-Key, which is a different failure mode (retried request, not independent concurrent requests).

**How to apply:** any future code path that reads a `product_locations` row to decide whether an operation is allowed, where the same request will later write to that row, must take the lock at the read (not just at the eventual write) if the check-then-write sequence needs to be race-free — the write-side lock alone only protects the write, not the decision made before it.

---

## 2026-08-20 — Phase 1: bundle-budget fix — split rooms and the CSV/XLSX importer out of the initial page load

**Decision:** `app/page.tsx`'s `Onboarding`/`ShopFloor` imports and `ShopFloor.tsx`'s `Counter`/`StockRoom`/`Overview`/`CloseShopFlow` imports are now `next/dynamic({ ssr: false })` instead of static imports; `StepStock.tsx`'s `CsvImporter` (which pulls in `exceljs`, see this file's entry above) is likewise dynamic.

**Why:** found during independent re-verification before merging Phase 1. `next build`'s own output showed the `/` route's First Load JS at 437KB, well over spec G's "< 250KB gzipped for the initial route" — because the whole app (every room, plus `exceljs` for a CSV-upload path most sessions never touch) was one client component tree statically imported from a single `"/"` route with no code-splitting. After the fix, the same build reports 124KB First Load JS for `/` (pre-gzip; the real transferred size is smaller still) — full 42/42 e2e + 55/55 Vitest suites re-run clean afterward to confirm the lazy-loaded rooms still work (loading states, hydration, no regressions).

---

## 2026-08-20 — Phase 2: invoices modeled as credit-bearing sales, not a shadow ledger table

**Decision:** there is no `invoices` table. A credit-bearing `Sale` (one with a `credit`-method payment line) *is* the invoice. `sales.due_date_at` is set once at sale time (`occurred_at + customer.terms_days` at that moment, snapshotted) rather than computed live from the customer's current terms. Payment allocation against invoices is a new `payment_allocations` table (`payment_event_id`, `sale_id`, `amount_minor`), written by the `take payment` endpoint in the same transaction as the `PAYMENT_RECEIVED` event append — not a projection, since it records a write-time choice (auto-oldest-first or manual), not a derived aggregate.

**Why:** `projections/customer_balance.py`'s own docstring already flagged `oldest_unpaid_at` as a Phase 1 placeholder specifically because no invoice concept existed yet. Introducing a second table that duplicates a fact `sales` already holds (amount, customer, date) would create two sources of truth for the same money fact — the exact thing the event-sourced architecture is designed to avoid. Snapshotting `due_date_at` at sale time (rather than joining to the customer's live `terms_days`) matters for the same reason `DAY_OPENED`/`DAY_CLOSED` correct-to-count rather than recompute: a term change shouldn't retroactively move the due date on an invoice that already went out.

**Alternatives rejected:** *A live-computed due date joined to `customers.terms_days`.* Rejected — changing a customer's terms would silently move every open invoice's due date and ageing bucket, misrepresenting history. *Storing allocation as a JSON field on the `PAYMENT_RECEIVED` event payload itself.* Rejected — `PaymentReceivedPayload` has no invoice-reference field today, and events are meant to be minimal, validated facts; allocation bookkeeping is exactly the kind of derived/operational detail that belongs in a queryable table, not packed into an immutable envelope.

**How to apply:** any Debt Book screen reading "invoices" reads `sales` filtered to credit lines, joined against `payment_allocations` for remaining balance — never a separate invoice entity. If a genuine need for invoice-level fields beyond what `sales` carries emerges later (e.g., partial invoice disputes), revisit as a new decision rather than bolting fields onto `sales`.

---

## 2026-08-20 — Phase 2: mobile money is a real signed-webhook seam behind a sandbox provider

**Decision:** `MobileMoneyProvider` is a `Protocol` (mirrors `notifications.py`'s `NotificationSender`) with one implementation this phase: `SandboxMomoProvider`, which simulates a customer approving a USSD push a few seconds after `request_payment` is called, and settles by calling back through the same `POST /api/v1/momo/webhook/{provider}` endpoint a real MTN/Airtel webhook would hit — HMAC signature verification, timestamp+nonce replay protection, and per-tenant encrypted credentials (`security/crypto.py`) are all real and enforced even though the provider on the other end is fake.

**Why:** neither I nor the user hold live MTN MoMo / Airtel Money merchant credentials in this sandbox, so "mobile-money API integration" this phase cannot mean a real provider connection — same constraint Phase 1 hit with WhatsApp/SMS delivery, resolved the same way. Building the webhook receiver to full production security standard (rather than a simplified dev-only endpoint) means swapping in real credentials later is a config change and a new `Protocol` implementation, not a rewrite — and it means the reconciliation engine, which is the actual "flagship" feature per spec D.7.3, is exercised against real transaction-shaped data end-to-end now rather than against hand-waved fixtures.

**Alternatives rejected:** *Skip mobile money entirely this phase, defer to when real credentials exist.* Rejected — the reconciliation UI, matching engine, and pay-link loop are the majority of Phase 2's stated value ("the phase that makes the product hard to leave") and are all provider-agnostic; building them against a sandbox now means only the credential/URL swap is later work, not the whole feature. *A simplified, unsigned dev-only webhook endpoint.* Rejected — the point of building it now is that it's genuinely production-shaped; an unsigned dev shortcut would need to be rebuilt, not swapped, when real credentials arrive.

**How to apply:** before connecting a real provider, swap `SandboxMomoProvider` for a real implementation of the same `Protocol` and populate real credentials via the existing `momo_provider_credentials`/`encrypt_secret` path — no endpoint or reconciliation-engine changes should be needed. Re-verify the real provider's actual webhook signature scheme matches what's implemented (providers vary) before trusting it in production.

**How to apply:** any new room or heavy, conditionally-used library (chart libraries, other file-format parsers) added to the Shop Floor shell should be wired in via `next/dynamic`, not a static import at the top of `ShopFloor.tsx`/`page.tsx` — the shell's single-route, all-client-side architecture means a static import there ships in the initial bundle regardless of whether the component ever renders.

---

## 2026-08-20 — Column-adding migrations use `IF NOT EXISTS`, because CREATE-step migrations use live ORM classes

**Decision:** `alembic/versions/0011_money_locations_payments.py` adds `sales.due_date_at` and `customer_balances.written_off`/`written_off_at` via raw `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` (and `DROP COLUMN IF EXISTS` on downgrade), not plain `op.add_column`/`op.drop_column`.

**Why:** this is the first migration in the codebase's history that adds a column to a table an *earlier* migration created — every prior "addition" across Phase 0/1 was a brand-new table (grep for `add_column` across `alembic/versions/` before this migration returns nothing). Every CREATE-step migration in this codebase creates its table via `SomeModel.metadata.create_all(bind=conn, tables=[SomeModel.__table__])` against the model class as it exists in the *current* codebase, not as it existed historically when that migration was authored. `tests/conftest.py` replays every migration from scratch against a fresh embedded Postgres for every test run — so the moment `models/sales.py::Sale` gained a `due_date_at` field and `models/customers.py::CustomerBalance` gained `written_off`/`written_off_at`, migration `0008_sales_quotes_returns`/`0006_customers` started creating those columns too, years "before" (in migration-history terms) this migration officially introduces them. A plain `op.add_column` here collided with a column `0008`/`0006` had already created and failed the entire suite with `DuplicateColumn`. This is fine and correct for a **real, already-deployed** production database (which only ever ran migrations through `0010`, so the columns genuinely don't exist yet when `0011` runs) — it only breaks the from-scratch replay path tests rely on. `IF NOT EXISTS`/`IF EXISTS` makes both paths correct simultaneously: a no-op against a fresh-replayed DB that already has the column, a real `ADD`/`DROP` against a genuinely incremental production upgrade.

**Alternatives rejected:** *Retroactively edit migration `0008`/`0006` to include the new columns at CREATE time instead of adding a new migration.* Rejected — rewriting an already-applied migration is exactly what Alembic's model assumes never happens; any real deployment that already ran `0008`/`0006` as originally written would never pick up the retroactive edit, silently drifting from what the migration history claims the schema is. *Check `information_schema.columns` in Python before calling `op.add_column`.* Rejected as needless complexity — Postgres's own `IF NOT EXISTS`/`IF EXISTS` clauses do exactly this, atomically, with no extra round trip.

**How to apply:** any future migration that adds a column to a table from an earlier migration (rather than creating a wholly new table) should use `ADD COLUMN IF NOT EXISTS`/`DROP COLUMN IF EXISTS` raw DDL for exactly this reason — not just here. Also note `alembic_version.version_num` is `VARCHAR(32)`: a revision id longer than 32 characters fails the version-stamping `UPDATE` with a truncation error that has nothing to do with the migration's actual DDL (hit while authoring this one — `0011_money_locations_payment_allocations` was 41 characters and had to be shortened to `0011_money_locations_payments`); keep every future revision id at or under 32 characters.

---

## 2026-08-20 — Phase 2: Debt Book backend (payment allocation, write-off, ageing)

**Decision:** `api/routers/debt.py` implements the Debt Book's read surfaces (header band, accounts table, per-customer statement/invoices/contact-history, "who to chase today") and write paths (`take-payment` with auto-oldest-first or manual allocation, `write-off`, `log-call`) against `sales`/`payment_allocations`/`customer_balances` directly — no new projection beyond the `PAYMENT_RECEIVED`/`DEBT_WRITTEN_OFF` handlers plan §2 already calls for. Three implementation calls worth recording:

1. **`reminder_log` deliberately has no `reject_direct_projection_write()` trigger.** Plan §1 itself describes this table as written by both the `REMINDER_SENT` projection and a manual "Log a call" action, and there is no `CONTACT_LOGGED` event type in the fixed registry to route the manual path through instead. Every other projection table in this codebase is framework-only; this is the first (and, by design, only) exception. See `models/reminders.py`'s docstring.
2. **The "who to chase today" score (D.6.7) is `overdue_amount x days_overdue`, not the full spec formula's `x payment reliability history`.** No per-customer on-time/late payment tally exists yet this phase — building one would mean either a new projection (out of scope: plan §1's table list doesn't include it) or a live aggregate over every historical payment's timing versus its invoice's due date, which is a meaningfully larger feature than the queue itself. Flagged here rather than silently dropped from the formula; a real reliability signal is a natural follow-up once enough payment history exists to make it meaningful.
3. **The write-off name-confirmation threshold (`WRITE_OFF_NAME_CONFIRM_THRESHOLD_MINOR = 5_000_00`) is hardcoded**, the same pattern `api/routers/sales.py::DISCOUNT_APPROVAL_THRESHOLD_PERCENT` already uses — spec D.10.6 describes thresholds (discount approval, write-off approval, variance alert, credit limits) as a configurable Back Office setting, but no settings/thresholds table exists yet in Phase 0-2's scope. Same disclosed gap as the existing discount threshold, not a new one.

**A genuine SQLAlchemy/asyncpg bug worth remembering:** grouping by a JSONB-extracted expression (`Event.payload["customer_id"].astext`) failed with Postgres error `GroupingError: column "events.payload" must appear in the GROUP BY clause` even though the SELECT and GROUP BY clauses were textually identical in the generated SQL — because each of the two separate Python expressions `Event.payload["customer_id"].astext` (one written in the SELECT list, one in `.group_by(...)`) compiles to its own bind parameter, and Postgres can't verify two different bind parameters are equal at parse time. Fixed in `api/routers/debt.py::_last_payment_by_customer` by building the expression once (`customer_id_expr = Event.payload["customer_id"].astext`) and passing that same object to both `select(...)` and `.group_by(...)`.

**How to apply:** any future query that both selects and groups by a JSONB-extracted (or otherwise computed) expression must reuse the same Python clause-element object in both places — never write the expression out twice, even if the two occurrences look identical.

---

## 2026-08-21 — MoMo webhook tenant identification: a body-carried claim, verified by signature, not the trust boundary itself

**Decision:** `POST /api/v1/momo/webhook/{provider}` keeps the URL shape plan §0.3 already specifies (no business id in the path). The tenant is identified by a `business_id` field carried in the webhook body itself; the endpoint opens `tenant_scoped_session(business_id)` using that claimed value, looks up that tenant's `momo_provider_credentials` row for the given provider, decrypts the HMAC secret (`security/crypto.py`), and verifies the signature. The claimed `business_id` grants nothing on its own — it only selects which secret to check against. A signature that fails to verify is rejected with a generic 401 regardless of what `business_id` was claimed; the actual trust boundary is the signature, not the claim.

Four hardening details, all necessary for this to actually hold under attack, not just in the happy path:
1. **The signature is verified over the raw request body bytes**, captured via `await request.body()` before any JSON parsing. `business_id` (and the rest of the payload) is read from a `json.loads()` of those same untouched bytes — never a re-serialized/re-encoded copy. Parsing then re-signing a re-serialized payload is a classic way canonicalization differences (key order, whitespace, float formatting, unicode normalization) make a legitimate signature fail or, worse, let a tampered one pass.
2. **`hmac.compare_digest`, not `==`**, for the signature comparison — this is the one comparison in the whole request path an attacker gets to influence byte-by-byte, so it has to be constant-time.
3. **An unknown `business_id` (or a tenant with no connected credentials for that provider) still runs a dummy `hmac.compare_digest` against a fixed local secret before returning 401** — the same 401, on the same rough timeline, as a wrong-signature failure against a real tenant. Without this, "tenant not found" would return measurably faster than "tenant found, signature checked, mismatched," turning response latency into an oracle for enumerating valid business ids.
4. **`momo_webhook_nonces`' uniqueness is scoped to `(business_id, provider, nonce)`, not `(provider, nonce)` alone** — a nonce is only meaningful within the one tenant's signature space it was generated in; a global uniqueness constraint would let one tenant's legitimate nonce collide with (and wrongly reject) another tenant's genuinely independent one, or let a compromised tenant grief another's webhook traffic.

**Alternatives rejected:**
- *Carry the tenant id in the URL path instead* (e.g. `/api/v1/momo/webhook/{provider}/{business_id}`). Rejected — a real MTN/Airtel webhook has no way to know or send OperatorOS's own internal `business_id`; it would send whatever merchant/shortcode identifier the provider itself assigned, which we'd still have to map to a `business_id` server-side before we could do anything RLS-scoped. That mapping step is unavoidable either way, so moving the identifier from body to path buys nothing and would mean reopening the URL shape the approved plan already fixed (§0.3: `POST /api/v1/momo/webhook/{provider}`).
- *Query `momo_provider_credentials` across all tenants to find whichever one's secret verifies* (try every tenant's secret until one matches). Rejected — O(tenant count) HMAC computations per webhook call is a real scalability problem at the spec's target shape (10,000 businesses, G.2), and it still needs a non-RLS-scoped cross-tenant query to enumerate candidates in the first place, reopening exactly the "no bypass role anywhere in the system" property the existing `businesses`-has-no-RLS decision was designed to preserve everywhere else.

**How to apply:** when a real MTN/Airtel provider implementation replaces `SandboxMomoProvider` (a later-phase seam-swap per plan §0.3), verify how that specific provider's webhook actually names the merchant/tenant in its payload and adapt the claim-field lookup accordingly — the signature-is-the-boundary architecture and the four hardening details above should not need to change.

---

## 2026-08-21 — Pay-link tokens are signed JWTs, not opaque DB-looked-up strings

**Decision:** `pay_links` has no `token` column. The public `/pay/{token}` page's token is a signed JWT (`security/tokens.py::create_pay_link_token`/`decode_pay_link_token`, `type: "pay_link"`) whose payload directly carries `business_id` and the `pay_links.id` it authorizes, with the link's own `expires_at` as the JWT's `exp` claim. `api/routers/pay.py` decodes and verifies the signature FIRST (no DB access needed to do this), then opens `tenant_scoped_session(business_id)` using the now-trusted claim and fetches the row by id, exactly the same "identify the tenant from a server-signed claim before any RLS-scoped query is possible" shape `api/deps.py::get_current_context` already uses for ordinary logged-in sessions via `decode_access_token`.

**Why:** the plan's own wording (D.6.5/§0.5) calls this "**a signed**, single-use, expiring token" — not an opaque random string. An opaque string would have needed a `SELECT ... WHERE token = :t` lookup to resolve which tenant it belongs to, but `pay_links` is RLS `ENABLE`+`FORCE` like every other tenant table, so that lookup would need the `app.business_id` GUC set correctly BEFORE the query that's supposed to tell us what it should be set to — the identical chicken-and-egg problem the MoMo webhook has (previous entry), solved here even more directly than the webhook's body-claim approach because a JWT's signature can be verified with zero database access at all. "Single-use" still comes from checking the referenced row's live `status` on every presentation (pending -> paid/expired, never back) — the token being cryptographically valid and unexpired is necessary but not sufficient; a `paid` link's token would still verify, but the endpoint must reject it anyway.

**Alternatives rejected:** *A random opaque token stored in a `token` column, looked up under the `businesses`-has-no-RLS-style exception applied to `pay_links` too.* Rejected — pay_links rows carry real tenant data (`amount_minor`, `customer_id`), unlike `businesses`' routing-only fields; carving out a second RLS-exempt table for a problem a signed token already solves without any exemption at all is strictly worse. *A random opaque token plus a separate `token_hash` index, mirroring `RefreshToken`'s at-rest hashing.* Rejected as solving the wrong problem — `RefreshToken` hashes because the raw token, once issued, is looked up FROM WITHIN an already-tenant-scoped context (the business is already known from other request state); here the token has to establish which tenant it's even for, which hashing doesn't help with.

**How to apply:** any future public, unauthenticated, single-resource capability link (this pattern will likely recur — e.g. a future public quote-approval link) should default to a signed JWT carrying the resource id and business_id, not an opaque DB-looked-up token, unless there's a specific reason (e.g. wanting to revoke a token without invalidating a whole `jwt_secret` rotation) to prefer the lookup-table shape instead.

---

## 2026-08-21 — Cash Box manual balance updates reuse `MONEY_TRANSFERRED` against a virtual `manual_adjustment` account

**Decision:** `POST /api/v1/cashbox/money-locations/{id}/update-balance` (D.7.1's "Manual" account cards' `Update balance` action) writes a `MONEY_TRANSFERRED` event moving the delta between the target account and a virtual counterparty account keyed `manual_adjustment`, rather than introducing a new event type for "a human corrected this account's balance to a new absolute figure."

**Why:** `events_registry.py` is fixed this phase (stated throughout the plan and enforced by not touching that file at all in this work). There is no event that means "set this account's balance to X" for an arbitrary money-location account the way `DAY_OPENED`/`DAY_CLOSED` already do specifically for `till` (`projections/money_location_balance.py`'s own docstring: "a correction-to-truth, not a delta... directly SETS the till account's balance"). `MONEY_TRANSFERRED`'s actual, already-implemented semantics — move `amount_minor` from one named account to another at a location — are an honest fit for a correction if the correction is modelled as money moving to/from a bookkeeping counterparty rather than appearing/disappearing from nowhere, which is also how a real accountant would journal an unexplained balance correction (a contra/adjustment account, not a floating entry).

**Alternatives rejected:** *Directly `UPDATE money_location_balance SET balance_minor = ...`.* Rejected outright — `money_location_balance` is protected by `reject_direct_projection_write()` specifically to prevent any write outside the projection framework driven by a real event; bypassing it here would undermine the one guarantee that trigger exists to provide, for the sake of a single feature. *Extend `MoneyTransferredPayload` with an `is_correction: bool` flag instead of a synthetic account.* Rejected — the payload shape is part of the fixed registry for this phase too, and a same-shape reuse needs no schema change at all, which is strictly less risk for the same outcome. *Route the correction through `EXPENSE_RECORDED`/`PAYMENT_RECEIVED` depending on the delta's sign.* Rejected — those event types carry semantics ("this is an expense," "this is a customer's payment") a balance correction doesn't actually have; using `MONEY_TRANSFERRED` against a clearly-named adjustment account keeps the ledger honest about what actually happened (an unexplained correction, not a fabricated expense or payment).

**How to apply:** `manual_adjustment` must never be surfaced in the Cash Box balances band (`api/routers/cashbox.py::get_balances` already filters it out) — it exists purely as `MONEY_TRANSFERRED`'s required "other side," not a real account a business holds money in. If a future phase adds a genuine `BALANCE_ADJUSTED`/`BALANCE_CORRECTED` event type to the registry, migrate this endpoint to it and stop touching `manual_adjustment` for new corrections (existing historical `MONEY_TRANSFERRED` events referencing it remain valid history, same as any other event).

---

## 2026-08-21 — Bug found: `await request.body()` after an `UploadFile` parameter raises `RuntimeError: Stream consumed`

**Bug:** `api/routers/momo.py::import_momo_csv` (the MoMo reconciliation CSV import, D.7.3) originally followed the same idempotency-fingerprint pattern every other mutating endpoint in this codebase uses: `raw_body = await request.body()`, hashed together with the method/path/business_id to detect a reused `Idempotency-Key` on a materially different request. Every other endpoint takes a Pydantic JSON body, where this works because FastAPI's own body-parsing and `request.body()` share the same cached-bytes mechanism. This endpoint instead takes `file: UploadFile` (`multipart/form-data`) — Starlette parses multipart bodies through a genuinely different, non-cached streaming code path to build the `UploadFile`, so by the time the route body ran, the underlying ASGI receive stream was already exhausted, and `await request.body()` raised `RuntimeError: Stream consumed` on every call. Caught by `tests/test_momo_reconciliation.py` (which exercises the real HTTP upload path, not a unit-level shortcut) — every test hitting this endpoint failed with a 500, not a 4xx, so the bug was in the endpoint itself, not the test's expectations.

**Fix:** compute the idempotency fingerprint from `content = await file.read()` (the file's own bytes) instead of `request.body()`, and read the file exactly once — the earlier version of the handler that added this endpoint had `await file.read()` again further down for the actual CSV parsing, which would have returned empty bytes on the second call regardless (a `SpooledTemporaryFile`-backed `UploadFile` is a forward-only stream) even if the first read hadn't already crashed the request.

**How to apply:** any future endpoint that accepts `UploadFile` (receipt-photo upload for expenses, per plan §3, is the next one on deck) must fingerprint idempotency from the read file content, never from `request.body()` — and must read the file exactly once, reusing the same `bytes` for both the fingerprint and the actual processing, not calling `.read()` twice.

---

## 2026-08-21 — Bug found: a plain `UniqueConstraint` on a nullable column does not stop two `NULL`s

**Bug:** `ReminderSchedule` (D.6.5) represents "the business default schedule" as the row with `customer_id IS NULL`, and a per-customer override as a row with `customer_id` set. `__table_args__` declared `UniqueConstraint("business_id", "customer_id", ...)`, which reads like it should prevent two default rows for the same business -- but standard SQL unique-constraint semantics treat every `NULL` as distinct from every other `NULL` (they're never considered "equal," including to each other), so Postgres silently allowed a second `customer_id IS NULL` row per business. `reminders_engine.py::_schedule_for_customer`'s `.scalar_one_or_none()` lookup for the default schedule then raised `MultipleResultsFound` -- not caught by any single-transaction test in isolation, but surfaced for real once `tests/conftest.py` started seeding one schedule per tenant (for cross-tenant isolation coverage, needing SOME `ReminderSchedule` row to attack with a tenant-B id) alongside `tests/test_reminders.py` tests that each create their own default via the API.

**Fix:** a genuine partial unique index, which Postgres DOES enforce correctly for the NULL case: `CREATE UNIQUE INDEX uq_reminder_schedules_business_default ON reminder_schedules (business_id) WHERE customer_id IS NULL` (migration `0015_reminders_segments`). `api/routers/debt.py::create_reminder_schedule` also checks for an existing default up front and returns a friendly 409, so the common case doesn't surface as a raw 500 from an unhandled `IntegrityError`. `tests/conftest.py`'s seeded schedule was changed from a (colliding) default to a per-customer override, which is both correct (no collision with anything a test creates) and better coverage (a previously-untested resource shape). `tests/test_reminders.py::test_a_second_default_schedule_is_rejected` proves the 409 path.

**How to apply:** any future "at most one row where some FK/reference column is NULL, but possibly many where it's set" constraint (this shape recurs -- e.g. "at most one primary location," "at most one default payment method") needs a partial unique index specifically for the NULL case, never a plain multi-column `UniqueConstraint` alone; the constraint is correct and sufficient for every case EXCEPT the one it was probably written to guard against.

---

## 2026-08-21 — Bug found: `take-payment` could double-allocate the same invoice under real concurrency

**Bug:** `debt_ageing.py::open_invoices_for_customer` — used by `take-payment`, MoMo settlement, and pay-link settlement to DECIDE how to allocate a payment against a customer's open invoices — read `sales`/`payment_allocations` with no row lock before that decision was made. This is the exact same "check-then-write across a request boundary without locking the read" shape the Phase 1 stock-oversell race was (`api/routers/sales.py::_check_stock`, fixed with `.with_for_update()`): two genuinely independent `take-payment` calls for the same customer (two different Idempotency-Keys — e.g. a cashier at the counter and someone settling the same account by phone, not a retried request) could both read the same invoice's stale `remaining_minor`, both fully allocate their payment to it, and both succeed with `201`. `on_payment_received_balance` (projections/customer_balance.py) *does* lock `CustomerBalance` with `.with_for_update()`, so the customer's aggregate balance still lands correctly — the bug is specifically that `payment_allocations` ends up summing to more than the invoice's `total_minor`, silently over-crediting one invoice while money that should have landed on a *different* open invoice (or as unallocated credit) gets misfiled against an already-paid one.

Proved with `tests/test_debt_take_payment.py::test_concurrent_take_payments_do_not_double_allocate_the_same_invoice`, same shape as `test_sales_atomicity.py`'s `test_concurrent_sales_for_the_last_unit_do_not_oversell`: two concurrent `take-payment` calls, each paying a customer's one 118000-minor-unit invoice in full. Before the fix: both returned `201` (236000 total allocated against a 118000 invoice). After: exactly one `201` and one `422` ("exceeds this customer's total open invoice balance"), matching the already-correct sequential behaviour.

**Fix:** `open_invoices_for_customer` already had a second, ungrouped `SELECT Sale.id ...` query (used only to build the id list for the allocation-sum lookup) sitting *after* the GROUP BY aggregate query. Reordered it to run FIRST and added `.with_for_update()` to it. `FOR UPDATE` can't be combined with the GROUP BY aggregate query itself (Postgres rejects that combination outright), so the lock has to be acquired via a separate, plain query — the second transaction blocks on it until the first commits (including its `payment_allocations` insert), then its own subsequent reads see that already-committed state instead of a stale one. `open_invoices_for_business` (the header/ageing-bucket report, not a decision-then-write path) was deliberately left unlocked — locking a whole business's sales rows for a read-only report would be needless contention for no correctness gain.

**How to apply:** any future query that reads `sales`/`payment_allocations` (or any projection-adjacent table) to decide an allocation, and will write based on that decision later in the same request, needs the same lock-before-decide shape — the aggregate/GROUP BY query alone is never enough on its own if `FOR UPDATE` can't attach to it directly. This is the second instance of the Phase 1 stock-check race's exact pattern found in Phase 2; worth checking for a third anywhere else a check-then-write decision spans a GROUP BY.

---

## 2026-08-21 — Phase 2 frontend: reminder schedule builder lives at Debt Book → Reminder schedule, not literally inside Back Office

**Decision:** docs/plans/phase-2.md §4 lists the reminder schedule/template editor as a "Back Office addition," but it's built as a fourth tab on the Debt Book room (`components/debt/ReminderScheduleTab.tsx`, code-split via `next/dynamic`) rather than inside `components/overview/BackOffice.tsx`. Back Office does gain the other two listed additions for real (MoMo "Connect now," the expense approval threshold) in a new Settings tab, which links to the Debt Book location for reminders rather than duplicating the editor.

**Why:** Back Office was Phase 1's Overview room only — a single scrollable analytics column with no settings sub-navigation of its own. The reminder editor is genuinely heavy (a merge-field live-preview panel, a 4-step schedule list, the approval-mode digest) and is also collections-specific state that every other Debt Book screen already reads (`reminderSchedule`, `reminderDigest`) — putting it a full room away from the accounts it governs, behind a settings tab that didn't exist yet, seemed like a worse information architecture than the plan's own literal room assignment implies. Since nothing in the spec requires the editor to be physically inside Back Office (only that a schedule/template editor exists and a Back Office pointer to it does), keeping it co-located with the rest of Debt Book's collections tooling — while still adding a real Back Office Settings tab for the two genuinely Back-Office-shaped settings (a provider connection, a numeric threshold) — was judged the more honest layout.

**Alternatives rejected:** *Build a full Back Office settings sub-nav now and move the editor there.* Rejected as scope creep for this phase — Back Office's own settings information architecture (D.10.6) is a bigger, separate design question than Phase 2's brief covers, and forcing it here risked a worse first cut than deferring it. *Duplicate the editor in both places.* Rejected — two copies of schedule-mutation UI reading/writing the same `reminderSchedule` state is a real source of drift bugs, not just extra code.

**How to apply:** when Back Office gets a real settings sub-nav (D.10.6), this is the natural point to either move the reminder editor there or keep the Debt Book location and drop the current placeholder-link Card in `SettingsTab.tsx` — revisit as a real decision then, not a silent relocation.

---

## 2026-08-21 — Phase 2 frontend: two real `/design` gaps found and fixed while building Debt Book, not worked around

**Decision:** two components/design/* primitives gained real capability, both found by trying to actually build a real screen against them rather than assumed in advance:

1. `Money.tsx`'s `emphasis` prop forced light-mode colors (`text-out`/`text-watch`/`text-in`) even when `surface="dark"`, and the negative-amount case did the same — both fail WCAG AA against `--steel`/`--steel-deep`, the exact contrast problem the existing `-dark` token variants (`in-dark`/`out-dark`/`watch-dark`) already exist to prevent for `Qty` and for `Money`'s own dark-surface non-emphasis case. Nothing before Phase 2 needed `emphasis` on a dark surface — the Debt Book header band's four figures (Owed to you/Overdue/Due this week/Collected this month, D.6) are the first. Fixed by keying `EMPHASIS_CLASS` on surface as well as kind, and by giving the negative case the same dark-surface swap. Covered by three new Money.test.tsx cases.
2. `ConfirmDialog.tsx` had no way to collect a field before confirming — every prior caller (write-offs included, per the `app/design/page.tsx` demo) only ever needed a message plus an optional typed-confirmation string. D.6.4's write-off flow needs a required reason captured *inside* the same confirmation gate. Rather than build a second, parallel confirm-with-reason component, `ConfirmDialog` gained an optional `children` slot (rendered between the message and the typed-confirmation input) and a `confirmDisabled` prop that adds to, rather than replaces, the existing typed-confirmation lock.

**Why:** per the working agreement ("check `/design` first; add there before using ad-hoc styling elsewhere") — both are genuine capability gaps a real screen surfaced, not cases where an ad-hoc one-off would have been faster. Keeping `emphasis` surface-aware means any future dark-background money figure (e.g. a future Cash Box or Overview card that goes dark) gets correct contrast for free instead of repeating this bug. Keeping the write-off reason field inside `ConfirmDialog` itself (not a separate pre-step dialog) matches the plan's own framing of write-off as one confirmation gate, not two.

**Alternatives rejected:** *Recolor the Debt Book header figures with a wrapper `className` instead of fixing `Money`.* Rejected outright — already documented as not working (`components/design/Money.tsx`'s own inner-span-owns-its-color behavior, confirmed in the 2026-08-20 "`Money`'s `emphasis` prop" entry). *A second `ConfirmDialogWithReason` component.* Rejected — two confirm-gate components with near-identical layout and behavior is exactly the "second thing to keep in sync" class of decision docs/DECISIONS.md's idempotency-store entry warns against for a different subsystem; the same reasoning applies here.

**How to apply:** any future dark-surface money figure needing forced coloring uses `emphasis` directly — never a wrapper `className` recolor attempt, which doesn't reach `Money`'s inner span. Any future confirm-gate needing an extra required field before unlocking uses `ConfirmDialog`'s `children`/`confirmDisabled`, not a bespoke dialog.

---

## 2026-08-21 — Phase 2 frontend: fixed a real, pre-existing Drawer overflow bug at the 375px viewport

**Decision:** `components/design/Drawer.tsx`'s `Dialog.Content` gained `max-w-full` alongside its existing `w-drawer`/`w-drawer-lg` width classes.

**Why:** found by actually driving a real Playwright click at the `mobile-375` viewport project, not by inspection — clicking the Account Drawer's "Write off debt" button (inside the Settings tab) timed out because the button was genuinely off-screen. `w-drawer`/`w-drawer-lg` are literal pixel widths (480px/720px, B.6) with no built-in viewport cap; a `position: fixed`, right-anchored element wider than the viewport renders most of its own content to the *left* of the visible screen, not just clipped at the right edge. This is not a Phase 2-only bug: it affects every existing `size="detail"` drawer app-wide, including Phase 1's Product Detail drawer — Phase 2's Account Drawer is just the first screen whose e2e suite clicked a control far enough into the drawer's content to notice. `max-width: 100%` on a `position: fixed` element resolves against the real viewport (the initial containing block for fixed-position elements), so this shrinks the drawer to fit narrow screens instead of overflowing, with zero effect at any width ≥720px where it was already correctly sized.

**Alternatives rejected:** *A responsive width override (e.g. `sm:w-drawer-lg` starting only above some breakpoint, plain `w-full` below it).* Rejected as more complex than needed — `max-w-full` alone already produces the correct fluid-then-fixed sizing behavior (100% width below 720px, exactly 720px at and above it) without a second breakpoint-specific class to keep in sync with the token's own value.

**How to apply:** any future fixed-width, fixed-position UI (drawers, the existing `w-modal`-sized dialogs, etc.) should carry the same `max-w-full` safety net by default, not just when a bug is found — a fixed pixel width token was never meant to be a promise that content fits every viewport on its own.

---

## 2026-08-21 — Phase 2 frontend: Airtel Money settlements route to the shared "momo" account, not a separate location

**Decision:** the pay-link page's Airtel Money option and `MomoReconciliationTab`'s sandbox settlement both post to `money_locations`' `"momo"` account key — there is no separate `"airtel"` money-location card in the Cash Box balances band.

**Why:** the seeded Cash Box dataset has three money locations (TILL, MOMO, BANK), matching D.7.1's own three example cards and Phase 1's existing `money_location_balance` account-key convention (`"cash"→"till"`, every other payment method keeps its own name). Adding a fourth, Airtel-specific location card was judged unnecessary fixture surface for this phase's actual point (proving the sandbox settlement round-trip and the reconciliation matching engine both work end-to-end) — the two providers share the same "mobile money in the till-adjacent account" story a real deployment would likely also collapse into one ledger account unless a business genuinely holds separate MTN/Airtel merchant balances.

**How to apply:** if a future need requires tracking MTN and Airtel balances separately (e.g. a business that actually reconciles them against two different merchant statements), add an `"airtel"` money location the same way `"momo"` exists today and change `SandboxMomoProvider`'s settlement routing (`lib/mock/store.ts`'s `requestMomoPayment`/`submitPayLink`) and the reconciliation tab's match action to route by `MomoTransaction.provider` instead of hardcoding `"momo"`.

---

## 2026-08-21 — The real OpenAPI-generated Zod client: `openapi-zod-client`, generated into `apps/web`, transport stays hand-rolled

**Decision:** `apps/web/lib/api/generated/client.ts` is generated by `openapi-zod-client` (`npm run generate:api-client`, wired to `apps/api/openapi.json`) and committed — not gitignored, so CI and anyone building the frontend never need Python+a venv just to typecheck the web app. `npm run check:api-client-fresh` (wired into `npm run lint`) regenerates into a throwaway temp file and fails the build if it differs from the committed copy, the same "keep it honest" gate `no-float-money` is on the backend. The generated Zod schemas (exported individually, e.g. `CustomerOut`, `MomoTransactionOut`, via `--export-schemas`) are the thing `lib/api/*.ts`'s real-API branches actually `.parse()` responses through. The generated file also exports a Zodios-based typed HTTP client (`api`/`createApiClient`) — that part is NOT used as the actual transport; every `lib/api/*.ts` function keeps calling the existing hand-written `apiRequest()` (config.ts) for the real network call, because that's the one place `credentials: "include"`, the `Idempotency-Key` header, and the existing `ApiError` shape already live, and duplicating that behind Zodios' own axios-based client/interceptor stack would be new surface for zero benefit. The schemas live in `apps/web`, not `packages/shared` — see `packages/shared/src/index.ts`'s comment for why (only one consumer exists today; a package must not depend on an app's generated output).

**Why `openapi-zod-client` over `orval`:** tried first per the brief's own ordering. It handled the full 95-route schema cleanly on the first attempt — no discriminated union actually exists for `StocktakeScope` in the real spec (`StocktakeStartRequest.scope`/`StocktakeOut.scope` are both plain `type: string`, not an enum or oneOf — FastAPI's schema export flattened whatever Python-side `Literal`/enum exists into a bare string), and no MoMo transaction schema exposes a raw JSONB payload field (`MomoTransactionOut` is a flat object of primitives) — so neither of the two "might choke" cases the brief flagged as a fallback trigger actually materialized. No reason to reach for orval.

**Alternatives rejected:**
- *Route real HTTP calls through the generated Zodios client instead of `apiRequest`.* Rejected — would mean re-implementing `apiRequest`'s credentials/idempotency-key/error-shape behavior as Zodios interceptors/config, a nontrivial rewrite of working, tested transport code for a cosmetic win. The generated schemas are the part the Phase 0 rule actually cares about (runtime response validation generated from the spec); the transport was never the placeholder.
- *Re-export the generated schemas from `packages/shared`.* Rejected — `packages/shared` is a dependency of `apps/web`, not the other way around; making it re-export something generated inside `apps/web` would either invert that direction or require physically moving the generated output into a package that has no other reason to hold API-shaped code yet. Revisit if a second consumer of `apps/api` ever exists in this workspace.
- *`--export-types` (plain TS types) instead of/alongside Zod schemas.* Not used — the Phase 0 rule is explicitly about runtime validation, not compile-time types; `apiRequest<T>`'s generic already gives compile-time shape-checking, the gap being filled here is that nothing previously checked a real response actually matched at runtime.

**How to apply:** any backend schema/route change (`apps/api/src/operatoros_api/schemas/*.py`, `api/routers/*.py`) must be followed by `python scripts/export_openapi.py` (regenerates `apps/api/openapi.json`) then `npm run generate:api-client` (regenerates the Zod client) before merging — `check:api-client-fresh` catches a forgotten regen, but only tells you it's stale, not what changed; re-run and diff to see the actual shape delta. Never hand-edit `lib/api/generated/client.ts`.

---

## 2026-08-21 — Frontend features with no real backend counterpart, found while wiring the generated client (full list, supersedes any earlier guess)

**Decision:** every function below keeps its `USE_MOCK_API` branch working exactly as before; the real-API branch throws a clear, typed error (`lib/api/config.ts::notSupportedByBackend`) instead of either calling a route that doesn't exist or silently succeeding against nothing. None of these got a new backend endpoint built to make the frontend's guess retroactively correct — per the working agreement, a genuine gap gets disclosed, not papered over.

**Genuinely no backend counterpart at all** (verified against apps/api/openapi.json's full 95-route surface, not guessed):
1. `debt.ts::listBroadcasts` — `customers.py` only has `POST /segments`, `GET /segments`, `POST /broadcast` (send, not list/history).
2. `debt.ts::updateReminderStep` — deeper than it first looked: there is no per-step edit route AND `ReminderScheduleUpdateRequest` has no `steps` field either. Steps can only be set at schedule creation time; the real API has no way to edit an existing step, full stop.
3. `debt.ts::snoozeCustomer` — no `/snooze` route anywhere in `debt.py`.
4. `momo.ts::markMomoAsCash`, `momo.ts::voidMomoTransaction` — `momo.py` only has `GET /transactions`, `GET /transactions/suggestions`, `POST /transactions/{id}/match`, `POST /transactions/import`.
5. `momo.ts::requestMomoPayment` (a standalone, cashier-initiated MoMo push against an arbitrary customer+amount) — the only real request-payment path is pay-link-scoped (`POST /pay/{token}/request-payment`), deliberately public/token-authenticated, a different security model. Chaining "create a pay link, then hit its endpoint" here would repurpose a public capability outside its designed flow without confirming that's the intended UX — flagged, not invented.
6. `sales.ts::undoSale` — no `/reverse` (or any) undo route for a completed sale.
7. `sales.ts::parkSale`/`listParkedSales`/`resumeParkedSale` — `sales.py` has no park/resume routes at all.
8. `sales.ts::listQuotes` — only create (`POST /sales/quotes`) and get-by-id (`GET /sales/quotes/{id}`) exist; no list.
9. `sales.ts::listTodaysSales` — no `GET /api/v1/sales` (or any sales-list) route exists at all.
10. `sales.ts::recordReturn` — the real `ReturnCreateRequest` needs each line's original `unit_price_minor`, and there is no `GET /sales/{id}` (or any sale_id-keyed lookup) to recover it from a bare `sale_id`. Not fixable inside `lib/api` alone without either a new/extended endpoint or the return flow's caller carrying the sale's line prices through from wherever it already has the `Sale` object on screen.
11. `stock.ts::listStocktakes`, `stock.ts::listTransfers` — only create and get-by-id exist for both resources; no list endpoint at all.
12. `stock.ts::moveStocktakeToReview` — `Stocktake.status` only ever transitions `counting -> posted`; `"reviewing"` is checked for in a couple of guards but nothing ever sets it. `GET .../review` (used instead) is a read-only view of current lines, not a status change.
13. `day.ts::reopenDay` — no `/reopen` route.
14. `till.ts::getOpenTillSession` — no GET for a single till session at all (only `POST /open`, `POST /{id}/close`); this session's own last `openTillSession()` result is cached in module state as the only available signal, and conservatively reports "no open session" after a fresh page load.
15. `receipts.ts::getReceiptPdfUrl` — no PDF-rendering endpoint; `GET /{receipt_number}` returns `rendered_text` (HTML), never a binary PDF or a URL to one. A pre-existing, already-disclosed Phase 1 gap (`api/routers/receipts.py`'s own docstring), reaffirmed here, not new.
16. `onboarding.ts` (both functions) — no `/api/v1/onboarding` (or any onboarding-shaped) route exists anywhere. Spec D.2 wants server-side, cross-device persistence; since blocking the app's entire first-run flow behind a real-API build that can never complete onboarding would be strictly worse, both branches fall back to the same `localStorage` mechanism, clearly commented as a stand-in. **What this actually costs, spelled out** (2026-08-22, after it was mistaken for working): the wizard's trading name renames nothing, its staff list creates no accounts and sends no invites, and its opening debtors and payables never reach the Debt Book or supplier balances — `state.staff`, `state.openingBalances.debtors` and `.payables` are read by no `lib/api` function at all. Only step 3's products are real. The steps now say so on screen (`KeptOnThisDevice`); closing the gap needs a business-rename endpoint, staff creation with PIN-setup delivery, opening-balance posting, and — for payables — the Phase 3 supplier model.
17. `expenses.ts::setApprovalThreshold` — the threshold is a hardcoded Python constant (`EXPENSE_APPROVAL_THRESHOLD_MINOR`), not a stored setting; `getApprovalThreshold` stays read-only against the known real value.

**Real backend behavior the frontend had wrongly assumed didn't exist (the opposite kind of finding — not a gap, a correction):** customer "hold" IS real, checked server-side — `CustomerAccountOut`/`Customer.status` is a free-form string column and `debt.py`/`reminders_engine.py` genuinely check for the literal value `"on_hold"` (excludes the customer from the chase queue and reminder digest). `customers.ts::updateCustomerHold` now writes it via `PATCH /customers/{id}` with `{ status: "on_hold" | "active" }` — no dedicated `/hold` endpoint was ever needed.

**A significant, disclosed frontend data-model gap, not a `lib/api` fix:** every manager-PIN-gated override (a sale's below-minimum price, a discount over 10%, a credit-limit breach) will be rejected by the real `create_sale` endpoint. `_verify_manager_override` needs both a manager's user id AND their PIN to look anything up; `RecordSaleInput`/`PaymentLineInput` only ever capture a PIN, never which manager entered it. `sales.ts::recordSale`'s real branch sends `manager_override_user_id: null` always, so today `body.manager_override_pin` alone can never pass verification server-side, even though the mock (which doesn't check WHO the PIN belongs to) accepts it fine. Fixing this for real needs a manager-selection UI Phase 1/2 never built — out of scope for a `lib/api` pass to invent.

**Endpoints that exist but return less than the frontend's view models want** — mapped as faithfully as the wire allows, with an inline comment at every field that has no source, not silently dropped: `Product` has no `wholesalePriceMinor`/`imageUrl`/readable `notes`/per-product unit conversions server-side at all; `StockMovementOut`/`TransferOut`/`StocktakeLineOut` carry ids but no display names (product/location), enriched via a separate products fetch where cheap, left as the raw id otherwise; `DebtHeaderOut` has no account/invoice counts (derived from a second `listDebtAccounts()` call, itself real data, except `dueThisWeekInvoiceCount` which stays 0 — invoice-level, not derivable in bulk); Cash Box's `GET /balances` returns no id usable by `update-balance`, closed via a deterministic-idempotency-key get-or-create against `POST /money-locations` rather than an invented lookup endpoint.

**Why:** disclosed here in one place (rather than scattered across code comments only) so a future phase deciding what to build next has a single, verified punch list instead of re-discovering each of these by hand again. Everything above was found by cross-checking `apps/api/openapi.json`'s actual route/schema surface against every `lib/api/*.ts` function, not by trusting either the pre-existing frontend code's guesses or an initial hand-audit's seed list at face value — several items above (4 through 14) are things neither source had flagged.

**How to apply:** before adding a new frontend action that assumes a backend capability, check `apps/api/openapi.json` (or `apps/web/lib/api/generated/client.ts`'s `endpoints` array) first — this phase's whole lesson is that "the frontend already calls it" was never proof the backend supports it. When a listed gap gets a real endpoint in a later phase, replace that function's `notSupportedByBackend` call with the real `apiRequest` call the same way every other function in `lib/api/*.ts` already does, and delete its line from this entry.

---

## 2026-08-21 — Security/correctness review: four fixes landed, verified independently

**Decision:** the requested "full system and security check" surfaced four real findings across the backend. Each was fixed, given regression test coverage, and independently re-verified (ruff/black/mypy/bandit/no-float-money gates + the full backend suite, 174 tests, all green) rather than trusted from an agent's self-report.

1. **Cross-tenant IDOR in MoMo reconciliation (High).** `api/routers/momo.py::match_transaction`'s `matched_to_type="invoice"` branch took a body-supplied `sale_id` and allocated a payment against it with zero ownership check — unlike `debt.py::take_payment`, which validates a body-supplied `sale_id` against the caller's own tenant-scoped open invoices first. A tenant-A request naming a real tenant-B `sale_id` was confirmed (before the fix) to return `201` and land a real `payment_allocations` row against another tenant's invoice. Fixed by resolving `open_invoices_for_customer` first (already tenant-scoped, already locked) and rejecting with `422` if the supplied `sale_id` isn't in that set — mirroring `take_payment`'s existing pattern instead of inventing a new one. Regression: `tests/test_cross_tenant_isolation_extra.py` (written adversarially against query-param and body-field IDOR shapes the existing generic path-param isolation walker structurally can't reach).
2. **No fail-closed guard on insecure default secrets (High).** `config.py::Settings.jwt_secret`/`secret_encryption_key` ship with committed, publicly-visible default values, safe only for `env=local`. Previously the only safeguard was a comment ("deployment tooling is responsible for asserting..."). Added a `model_validator(mode="after")` that raises `ValueError` at `Settings()` construction time — i.e. the process refuses to start — if either default is still in effect and `env != "local"`. Regression: `tests/test_secrets_and_pii_logging.py`.
3. **Raw PII in application logs (Medium).** `mobile_money.py::SandboxMomoProvider.request_payment` logged the customer's raw phone number at `INFO`; `notifications.py::LoggingNotificationSender.send` logged the raw recipient and subject line. Both now log through `security/identifiers.py::hash_identifier` (the same HMAC-pepper hash already used for phone lookup indexes) or, for `subject`, its length only — enough to correlate/debug without a plaintext PII trail in centralized logs. Regression: `tests/test_secrets_and_pii_logging.py` (via `structlog.testing.capture_logs()`).
4. **No rate limit on manager-PIN overrides (Medium).** `api/routers/sales.py::_verify_manager_override` (backs the min-price, over-10%-discount, and over-credit-limit overrides) had no throttling — a cashier who knew or guessed a manager's user id could brute-force their PIN with unlimited attempts. Now reuses the existing `LockoutTracker` (`security/rate_limit.py`, the same class `auth.py::login` uses), keyed on `(business_id, manager_user_id, caller_user_id)` — deliberately including the caller's own id, not just the manager's, so a bad actor can only ever lock themselves out of that manager's override, never deny it to every other cashier. Regression: `tests/test_sales_atomicity.py::test_manager_override_locks_out_after_repeated_wrong_pins`.

**Alternatives rejected:**
- *Global `(business_id, manager_user_id)` lockout key for the PIN override, matching login's `(business_id, identifier, device_id)` shape more literally.* Rejected — login's third component (`device_id`) is a property of the person trying to authenticate; here the equivalent "who's trying" is the caller, not the manager being verified. Keying without the caller would let one malicious cashier lock every other cashier out of a manager's override entirely, turning a brute-force defense into a denial-of-service weapon against legitimate staff.
- *A warning log instead of a hard failure for insecure default secrets.* Rejected — the whole point of a fail-closed check is that a crashed process is impossible to miss in a way a log line scanned by nobody is not; `env=local` (tests, local dev) is unaffected since the guard only applies outside it.
- *Also fixing the lower-severity idempotency-key gaps on `create_category`/`create_unit` and the dependency/CORS audit items flagged mid-review.* Deferred, not silently dropped — those are data-pollution-only (no money/PII impact) and belong in the consolidated findings report as open items, not folded into this entry with the four money/PII/auth-impacting fixes above.

**How to apply:** any new endpoint that accepts a body-supplied id referencing another tenant-scoped resource (a second IDOR shape beyond #1) must validate ownership the same way `take_payment`/`match_transaction` now both do — resolve via a tenant-scoped query first, then check membership, never trust the id as-is. Any new PIN/secret-verification path should default to reusing `LockoutTracker` rather than being built unthrottled and retrofitted later.

---

## 2026-08-21 — Same-origin cutover: `/pay` path rename, no API subdomain

**Decision:** production serves `apps/web` and `apps/api` from the same origin (`operatoros.orion-labs.dev`) — nginx routes `/api/*` to `apps/api` and everything else to `apps/web` — rather than a separate `api.operatoros.orion-labs.dev` subdomain. To make that routing split unambiguous, `api/routers/pay.py`'s router prefix moved from bare `/pay` to `/api/pay`. Every call site updated to match: `lib/api/pay.ts` (all three functions), the three backend test files that hit these routes directly (`test_pay_link_security.py`, `test_momo_paylink_roundtrip.py`, `test_cross_tenant_isolation_extra.py`), `real-api-contract.test.ts`, and both generated artifacts (`openapi.json`, `lib/api/generated/client.ts`, regenerated fresh rather than hand-edited per the existing rule). The customer-facing PAGE stays exactly where it was, at `/pay/[token]` in `apps/web` — that's a different thing (a Next.js route, not an API path) and was never part of the collision.

**Why:** same-origin was ruled out at first specifically because of a real routing collision: the frontend has a page at `/pay/[token]`, and the backend (deliberately, per the original "Pay-link tokens are signed JWTs" entry) had its public pay-link API at the byte-identical path `/pay/{token}`, outside `/api/v1` on purpose. Route both through one origin and nginx has no way to tell "serve the page" from "the page's own client-side JS calling its API" apart by URL alone — a subdomain was the standard way to dodge that. But the actual constraint was never "must be a separate origin," it was "the API can't sit at the exact path the page already owns." Renaming the API side to `/api/pay/{token}` — still visually distinct from the versioned, authenticated `/api/v1/*` surface, since it's a genuinely different auth model (no bearer token, signature-verified instead) — removes the collision entirely while keeping one domain, no CORS, no second TLS cert to manage, and no new DNS record. `pay.py` was the *only* router not already under `/api/v1`, and `/pay/[token]` was the *only* frontend page colliding with any backend path — confirmed by inventorying every router prefix against every `app/**/page.tsx` route, not assumed.

**Alternatives rejected:**
- *Dedicated `api.operatoros.orion-labs.dev` subdomain, real CORS.* The original plan — technically fine, but strictly more moving parts (a DNS record, a cert `--expand`, a CORS allowlist to maintain) for a problem with a smaller, purely in-repo fix. Reversed once the actual blocker (the path collision, not same-origin itself) was identified precisely.
- *Route by request header (`Accept`, `X-Requested-With`) instead of by path.* Rejected as fragile — an easy-to-misconfigure nginx rule depending on client behavior, versus a path rename that's unambiguous and visible in the code itself.

**How to apply:** nginx for `operatoros.orion-labs.dev` needs exactly two location blocks: `/api/` → `apps/api` (127.0.0.1:8000), `/` → `apps/web` (127.0.0.1:3001). `NEXT_PUBLIC_API_BASE_URL` is unset/empty in production (relative same-origin requests) rather than pointing at a second host. No CORS middleware needed in `apps/api` as a result. If a future frontend page is ever added at a path matching an existing bare (non-`/api/v1`) backend route, this is the fix to reapply: move the backend route under `/api/...`, never invent a same-origin routing hack.

---

## 2026-08-21 — First real production deploy: four bugs no test suite could have caught, plus the topology this app now actually runs on

**Decision:** `rebuild/phase-2` is live at `operatoros.orion-labs.dev` on web-01/web-02, replacing `operatoros-owner-dashboard` (deleted, not archived — see below). Infra: Postgres + Redis are managed (a new Supabase project, transaction-mode pooler on :6543; Upstash Redis over `rediss://`) rather than self-hosted on web-01/web-02 — those are ~1GB boxes with no swap, already running two other live, unrelated apps (`disaster-warning-map`, the `patient0.tech` portfolio), and installing Postgres+Redis+uvicorn+Celery there risked the OOM killer taking one of those down. `apps/web` deploys as a Next.js **standalone** build (`output: "standalone"` in `next.config.mjs`) assembled off-box and shipped as a ~21MB bundle, rather than running `next build`/`next start` with a full `node_modules` on-box, for the same memory-pressure reason. `apps/api` runs as `operatoros-api.service` (uvicorn) + `operatoros-worker.service` (Celery); Python 3.12 installed via `uv` after the box's Ubuntu 20.04 arm64 ports mirror turned out to be degraded (slow, intermittent 503s) badly enough to make `apt`+deadsnakes impractical.

**Four real bugs found only by actually deploying, each fixed and regression-tested/verified before being called done:**
1. **`openpyxl` was dev-only in `pyproject.toml`** but `product_import.py` imports it directly for XLSX parsing — a real production code path. `pip install .` (correct for prod — shipping pytest/ruff/mypy/bandit into a runtime image is its own problem) crashed on the very first import. Moved to main `dependencies`.
2. **`alembic/env.py` crashed on a percent-encoded DB password.** `config.set_main_option` writes through `ConfigParser`, whose interpolation syntax treats a bare `%` as `%(name)s` syntax — any real deployment URL with `%40` for a literal `@` (needed the moment a password contains one, which this one did) crashed before a single migration ran. Fixed by escaping `%` as `%%` (ConfigParser's own documented escape) before `set_main_option`, never touching the ini file itself.
3. **Celery's `rediss://` broker/backend needs explicit `ssl_cert_reqs`,** unlike `redis-py`'s own `from_url` (used elsewhere in this app) which infers TLS from the scheme alone. `broker_use_ssl`/`redis_backend_use_ssl={"ssl_cert_reqs": ssl.CERT_REQUIRED}` added, conditioned on the URL scheme so local dev's plain `redis://` is unaffected.
4. **`asyncpg.exceptions.DuplicatePreparedStatementError` under Supabase's transaction-mode pooler.** asyncpg names prepared statements sequentially per physical connection; under transaction-mode pgbouncer the "connection" it sees can be a different backend on every checkout, so a reused statement name collides with a different session's. Didn't reproduce on the first box under a light test, did on the second under real concurrent traffic — a probabilistic bug, not a deterministic one, and invisible to the test suite entirely (tests run against a single embedded Postgres with no pooler in front of it). Fixed with the documented remedy: `connect_args={"statement_cache_size": 0}` on the async engine.

**One correctness bug caught before it shipped, not after:** the existing Celery unit (`worker -B`, embedded beat) was written for a single-instance topology (local dev, docker-compose). Installing it identically on *both* web-01 and web-02 would have run two independent beat schedulers with no leader election — every scheduled job (nightly projection audit, recurring-expense drafts, the 15-minute reminder tick) would fire twice. Fixed by splitting into two unit variants before either was ever exposed to real traffic: `operatoros-worker.service` (worker + beat) on web-01 only, a `-B`-less variant on web-02. Both still process the shared task queue; only one issues scheduled jobs.

**Alternatives rejected:**
- *Fall back to Supabase's session pooler (:5432) instead of fixing the asyncpg statement-cache issue.* Rejected — the transaction pooler scales connections better and the fix (`statement_cache_size=0`) is a one-line, well-documented, zero-downside change; falling back would trade a real fix for a workaround.
- *Install Postgres/Redis on web-01/web-02 to keep everything self-hosted, matching the rest of this infra's style.* Rejected given the measured ~450MB available RAM on boxes already running two unrelated live apps — the failure mode (OOM-killing someone else's service) is worse than the inconsistency of using managed services for just these two pieces.
- *Delete-not-archive the old `operatoros-owner-dashboard`.* User's explicit call, made after being shown the tradeoff (stop-serving-but-keep-files was the offered default, for rollback safety) — chose full deletion once satisfied the new stack was verified end-to-end against the real public domain first.

**How to apply:** any new async DB engine construction in this codebase must go through `db.py::get_engine` (already does) rather than a fresh `create_async_engine` call, to inherit the `statement_cache_size=0` fix. Any new scheduled Celery task added to `celery_app.py`'s `beat_schedule` only ever needs registering once — it will run on web-01 automatically, never duplicate it into the no-beat unit. A future third app box joining this topology needs the no-beat worker variant, not the beat one, unless web-01's beat unit is explicitly being replaced.

---

## 2026-08-21 — Real frontend auth: httpOnly-cookie session, and two gaps found by actually logging in through a browser

**Decision:** the frontend now has real login, backed by an httpOnly-cookie session rather than a raw token anywhere in client-side JS. `app/session/{login,totp,refresh,logout}/route.ts` are Next.js server-side proxies to `apps/api`'s real auth endpoints (`/api/v1/auth/{login,totp/verify,refresh,logout}`), called over the internal `127.0.0.1:8000` hop; on success they set `operatoros_access_token`/`operatoros_refresh_token`/`operatoros_business_id` as `httpOnly, Secure, SameSite=Strict` cookies and never return a raw token to the browser. `apps/api/api/deps.py::get_current_context` now accepts the access token from that cookie as a fallback when no `Authorization` header is present (Authorization still wins and works unchanged for any non-browser client). `lib/auth-store.ts` replaces the deleted `lib/demo-auth-store.ts`, keeping the same shape (`signedIn`/`shutterState`/`attemptsRemaining`/`lockedUntil`/`signIn`/`submitTwoFactor`/`signOut`) so `Shutter.tsx`/`TopNav.tsx`/`page.tsx` needed rewiring, not a rewrite — and branches on `USE_MOCK_API` the same way every `lib/api/*.ts` function does, so `e2e/helpers.ts`'s mock sign-in flow (fixed phone/PIN/code, always-2FA) keeps working against no real backend.

**Two things this surfaced, found only by actually trying to log in through a browser rather than curling API endpoints directly:**
1. **The production build was silently running in mock mode.** `lib/api/config.ts::USE_MOCK_API` is `!process.env.NEXT_PUBLIC_API_BASE_URL` — a check on whether that var is *set*, not whether `API_BASE_URL` resolves to same-origin. Leaving it unset (reasoning "same-origin, so it doesn't matter") was wrong for this specific flag; the site looked like it was working because it was showing real-looking mock data, not because it was talking to the real backend at all. Fixed by setting `NEXT_PUBLIC_API_BASE_URL` explicitly at build time in `deploy-operatoros.sh` — the value only needs to be non-empty, but it's set to the real domain for clarity.
2. **The Shutter login screen was never wired to real auth at all.** It ran on `lib/demo-auth-store.ts`, a Phase-0 scaffold explicitly commented "must be deleted — not extended — once the real login endpoint lands," with a hardcoded demo phone/PIN and no real session. This predates this session's work — it's a gap that survived every earlier phase because it's structurally separate from the `lib/api/*.ts` mock/real pattern the rest of the frontend follows (a different file, a different store, never touched by the earlier OpenAPI-client wiring pass), so nothing that audited `lib/api/*.ts` against `openapi.json` was ever going to catch it.

**Business identification at login:** `LoginRequest.business_slug` is required (see the RLS/tenancy entry above — apps/api resolves the tenant from an explicit slug, since Phase 0 never got real subdomain routing). The frontend had no field for this at all. Rather than inventing subdomain infrastructure, this follows the spec's own stated fallback exactly (D.1: "the business name, if the subdomain or last-used tenant is known"): the resolved slug is remembered in `localStorage` after a successful sign-in, and the Shutter only asks for it explicitly when nothing is remembered yet (skipped entirely in mock mode, which has no real multi-tenancy concept).

**Alternatives rejected:**
- *Store tokens in `localStorage`/a non-httpOnly cookie, attach `Authorization` from client JS.* Rejected on a system handling real money — an XSS bug anywhere in the frontend would be enough to exfiltrate a live session. httpOnly means client-side JS literally cannot read the token, XSS or not.
- *Route every authenticated API call through a Next.js proxy that translates the cookie into an `Authorization` header.* Would work, but doubles every request's latency (browser → Next.js → apps/api) and requires nginx to route based on more than just path. Cheaper fix: let `apps/api` accept the cookie directly — same-origin cookies are sent automatically regardless of which process nginx routes a path to, so `lib/api/config.ts::apiRequest`'s direct `/api/v1/...` calls needed no change at all.
- *A route-handler catch-all at `/api/session/*`.* Would collide with the existing blanket `location /api/` → `apps/api` nginx rule (the same class of collision the `/pay` rename fixed). Used `/session/*` instead — outside `/api/` entirely, no nginx change needed.

**Known follow-up, not blocking:** Playwright's local `webServer` still runs `next start`, which warns and falls back to a non-standalone runtime now that `next.config.mjs` sets `output: "standalone"` — e2e tests pass, but aren't exercising the exact artifact production runs (`node .next/standalone/server.js`). The real standalone server was verified directly instead (manual SSH smoke tests against web-01/web-02, real CSP nonces, real 200s). Worth pointing `playwright.config.ts` at the standalone entrypoint later; not done here given everything else this session already covered.

**How to apply:** any future server-only secret or token this app needs to hand the browser follows this same pattern — a Next.js route handler holds it, an httpOnly cookie carries it, client-side JS never touches it directly. If apps/api ever gains a real subdomain-per-tenant routing story, the business-slug field/localStorage-remembering here is the thing to delete, per `docs/DECISIONS.md`'s existing RLS/tenancy entry's own "how to apply" note.

---

## 2026-08-21 — Two more bugs found only by actually logging in through a real browser against production

**Decision, bug 1 — cross-box asset 404s crashing hydration:** `deploy-operatoros.sh` builds `apps/web` independently on web-01 and web-02. Confirmed empirically (not theoretical) that Next.js's webpack output is not fully reproducible across two separate build invocations of the identical commit — even after `next.config.mjs::generateBuildId` was set to the git commit hash (closing the build-id half of the mismatch), individual chunk content hashes still sometimes differed between the two boxes' builds. HAProxy round-robins every request independently, so a browser's HTML from one box could reference a chunk hash the other box never produced — 404, `ChunkLoadError`, hydration crash. Fixed with HAProxy cookie-based session stickiness (`cookie SRVID insert indirect nocache httponly secure` on `backend haproxy_backend`, one cookie value per server) — once a browser is assigned a box, it stays there for the session, so its HTML and its own asset requests always agree. This applies to every site behind this LB (`patient0.tech`, `disaster-warning-map` too), which is harmless for both.

**Bug 2 — the phone number sent to login was missing its country code.** The Shutter shows "+250" as a static prefix span next to the phone field, but nothing combined it with the field's own value before sending — `identifier` went to `apps/api` as bare local digits (`"788000000"`), which `security/identifiers.py::normalize_phone` leaves untouched (it only adds `+250` for a leading-`0` ten-digit number), so it never matched the hash of the full number (`"+250788000000"`) the account was actually registered with. Every login attempt failed as a generic "wrong credentials," indistinguishable from an actually-wrong PIN. Fixed by combining the prefix into the value `Shutter.tsx` passes to `signIn` (real-API branch only — mock mode's fixed demo phone doesn't need it).

**Alternatives rejected (bug 1):**
- *Build once, ship the identical artifact to both boxes* (what the original manual cutover did, correctly). The more thorough fix — guarantees byte-identical assets fleet-wide, not just per-session consistency — but requires either a new inter-box transfer mechanism or loosening the forced-command deploy key's restriction to allow artifact upload, given each box currently only knows how to trigger its own local build. Deferred as a follow-up; session stickiness fixes the actual crash today with a single config change.
- *`balance source` (IP-based stickiness) instead of a cookie.* Rejected — mobile carriers commonly NAT many users behind one IP, which would pin unrelated users to the same box and defeat load balancing far more than the cookie approach does.

**How this was actually caught:** every earlier verification this session was `curl`-based (real, but API-shape-only) or checked that the page rendered *some* HTML. Neither would have caught either bug — the 404s only manifest as a real browser executing real `<script src>` tags across a real session, and the phone-prefix bug only manifests when an actual login attempt is submitted with realistic form field values, not a hand-built JSON body a curl command already gets right. A seeded verification account (`scripts/seed.py`, run against the admin DB connection since RLS correctly blocks the ordinary app role from self-service business creation) plus a real headless-browser pass was what surfaced both. Worth repeating as the actual bar for "verified" on this app going forward: a real browser doing the real flow, not a curl command shaped like one.

---

## 2026-08-21 — Three more bugs on the way to the first real login: a real RLS gap, a wrong pepper, and a deploy race

Even after fixing the two bugs above, real login *still* failed with the identical generic "wrong credentials" response for reasons that turned out to be three more independent things, each masked by the same generic auth-failure message and each requiring going further than a browser test to actually find.

**Bug 3 — `businesses` had Row Level Security enabled in the live Supabase database with zero policies, silently denying the app role.** `alembic/versions/0001_tenancy_and_rls.py` explicitly does **not** enable RLS on `businesses` (comment: "the tenant root, not tenant-owned data") and grants `SELECT/INSERT/UPDATE` directly to `operatoros_app` instead — this is correct and matches how the local/test Postgres (via `pgserver`) behaves, where the whole login flow already passes 173 tests. In this Supabase project, `businesses` had `relrowsecurity = true` anyway, with `pg_policies` returning zero rows for it — Postgres's default for "RLS on, no matching policy" is deny, so `resolve_business_by_slug` (the very first step of login) always returned nothing, and every login failed identically to a real wrong-password case. **First proposed fix — `ALTER TABLE businesses DISABLE ROW LEVEL SECURITY` — was wrong and was caught before running:** Supabase grants every `public`-schema table full `SELECT/INSERT/UPDATE/DELETE/TRUNCATE` to its own `anon` and `authenticated` roles by default, independent of anything this app's migrations request. RLS being enabled was accidentally the *only* thing stopping `businesses` from being fully readable and writable through Supabase's own auto-generated REST API to any unauthenticated caller on the internet. The actual fix keeps RLS enabled and adds `CREATE POLICY operatoros_app_full_access ON businesses FOR ALL TO operatoros_app USING (true) WITH CHECK (true)` — scoped to only the app's own role, so `anon`/`authenticated` stay exactly as blocked as they already were.

**Bug 4 — the seeded verification account's `phone_hash` was computed with the wrong pepper.** `security/identifiers.py::hash_identifier` HMACs the phone number using `settings.jwt_secret` as the key. `scripts/seed.py` was run directly from a local machine without `OPERATOROS_JWT_SECRET` set to the real production value, so it silently used the local-dev default secret as the pepper — a *different* hash than what the live API (running with the real production `OPERATOROS_JWT_SECRET`) computes for the identical phone number at login time. The account existed, the PIN was right, and the lookup still found nothing, because the stored hash and the looked-up hash were never going to match. Manual verification scripts run the same way independently confirmed "the data looks right" without ever catching this, because they used the same wrong pepper consistently against themselves. Fixed by re-seeding with `OPERATOROS_JWT_SECRET` set explicitly to the real value.

**Bug 5 — a CI-triggered auto-deploy raced a manual one on the same box, corrupting the build.** Pushing a commit while a manual `bash /opt/deploy-operatoros.sh` SSH session was still running on the same host triggers `deploy.yml` independently, and two `next build` processes writing into the same `.next` directory concurrently produced `ENOENT: no such file or directory, copyfile ... edge-runtime-webpack.js` — a file one process expected that the other had already moved or not yet written. Not a design flaw exactly, more an operational hazard specific to debugging-via-manual-SSH-alongside-an-automated-pipeline; resolved by not pushing new commits while a manual deploy is in flight, and by clearing the `.next` directory before a from-scratch retry rather than assuming stale state is harmless.

**Alternatives rejected (bug 3):** disabling RLS on `businesses` outright, as first proposed — rejected specifically because it was checked against Supabase's actual default grants before running, not assumed safe by analogy with plain Postgres (where a table with no `ENABLE ROW LEVEL SECURITY` statement is simply ungated by RLS, with no equivalent of `anon`/`authenticated`-wide default grants waiting underneath).

**How to apply:** any future table this app's own migrations deliberately leave without RLS (there is currently only `businesses`) needs its Supabase-side RLS state checked explicitly (`select relrowsecurity from pg_class where relname = '...'`, `select * from pg_policies where tablename = '...'`) rather than assumed to match the migration's intent — Supabase's platform defaults can diverge from a plain-Postgres migration's literal SQL. Any script that calls `hash_identifier` (or anything else keyed by `settings.jwt_secret`) against a non-local database must have the real `OPERATOROS_JWT_SECRET` in its environment explicitly; there is no way to detect a silently-wrong pepper after the fact except a hash mismatch that looks identical to a genuinely wrong credential. Never push to `main` while a manual deploy is running against the same box it'll also trigger a deploy on.

---

## 2026-08-21 — The bug that made every previous "verified" claim above only half-true: web-02 was serving a frozen build

**What was actually wrong:** `operatoros.service` on web-02 had `WorkingDirectory=/opt/operatoros-monorepo-web/apps/web` — a leftover directory from an earlier cutover attempt that `deploy-operatoros.sh` never touches (it deploys to `/opt/operatoros-monorepo/`, and web-01's unit correctly pointed at `/opt/operatoros-monorepo/apps/web/.next/standalone/apps/web`). Two lines of drift between two boxes that were supposed to be identical. Every deploy pulled main, rebuilt cleanly, restarted the service successfully, printed its success line, and CI went green — while web-02 kept serving a build frozen at `WWaZnyi_jSn52U8fWCtA0` from hours earlier, including the pre-`NEXT_PUBLIC_API_BASE_URL` **mock-data** frontend with its hardcoded "Kigali Hardware Supplies" and demo phone number.

**Why it survived so much verification.** This is the important part, because the three entries above all end with confident "verified in production" claims:
- HAProxy round-robins, so only ~half of requests hit the stale box. Every single-request smoke check is a coin flip, and each one that passed was read as proof.
- The *real browser* Playwright login pass — the bar the entry above explicitly sets as the standard for "verified" — passed, because it landed on web-01. Raising the bar from curl to a real browser was right, and still wasn't enough: the flaw was in the *sampling*, not the depth of the check.
- Both boxes reported the correct `git rev-parse HEAD`, and `systemctl is-active` returned `active` for all six units. Both facts were true and both were irrelevant: the repo state and the service's liveness say nothing about whether the running process is executing the code in that repo.
- `.next/BUILD_ID` on disk in the deploy directory read correctly on both boxes — the stale build lived in a *different directory*, so every check pointed at the deploy path confirmed itself.

**Decision:** fix the unit (now byte-identical to web-01 apart from the intentional worker `-B` beat flag), delete the stale `/opt/operatoros-monorepo-web/`, and — the part that matters — make the deploy script *assert its own success* instead of inferring it. `next.config.mjs::generateBuildId` already pins the build ID to the git SHA, so the SHA just deployed **must** appear in the HTML the running server returns; `deploy-operatoros.sh` now polls `127.0.0.1:3001` for exactly that, polls `127.0.0.1:8000/health`, and greps the served HTML for a known mock-data string (the `USE_MOCK_API` fallback is invisible in a 200 and has caused a production incident once already). Any of the three failing exits non-zero and turns CI red on that box.

**Alternatives rejected:**
- *Just fix the unit and move on.* The unit was a symptom. The actual defect is a deploy pipeline whose success signal was "the build command exited 0 and systemd restarted something" — that would have gone green just as happily for the next path-drift, permissions, or stale-artifact bug.
- *Verify from CI over the public domain after deploying.* Doesn't work here: the LB picks a box, so a post-deploy check through the domain samples one of two boxes at random — the precise blind spot that hid this. The assertion has to run **on the box being deployed, against its own localhost**, which is exactly where the deploy script already is.
- *Add a `/version` endpoint returning the deployed SHA.* Redundant — `generateBuildId` already puts the SHA in every HTML response, so the signal existed and simply wasn't being checked.

**How to apply:** "the deploy succeeded" is not a claim any pipeline should make on the basis of a clean build plus a restart — it has to be proven by fetching from the running process and confirming the response contains something unique to the commit just deployed. More generally: when infrastructure is redundant, verifying it through the load balancer verifies *a random member of it*, not the fleet. Check each box on its own (via its own localhost during deploy, or by pinning the HAProxy `SRVID` stickiness cookie to a specific server when testing through the domain from outside) before claiming anything is live everywhere.

---

## 2026-08-21 — The business field deleted itself as you typed into it

**What was wrong:** `Shutter.tsx` rendered the business-slug field as `{USE_MOCK_API || businessSlug ? null : <field/>}` — a condition evaluated against the field's own **live** value. The input's `onChange` writes straight to `businessSlug`, so the first keystroke made it truthy and unmounted the input mid-type. The user was left holding a one-character slug, which failed the business lookup, which surfaces as `GENERIC_AUTH_FAILURE` — rendered by the Shutter as *"That PIN doesn't match this number."* The error pointed at the PIN; the PIN was fine.

**The worse half of the same bug:** the condition also meant that once *any* slug was in `localStorage`, the field never rendered again. A wrong remembered slug — a typo saved on a first sign-in, a renamed business — was therefore permanently uncorrectable through the UI: every attempt failed on the business lookup, reported as a PIN error, with no visible field to fix and no way to discover the real cause short of clearing site data. A login form that can enter a state it cannot leave is a worse defect than the cosmetic one that exposed it.

**Decision:** render the field unconditionally on the real-API branch, prefilled from the remembered tenant instead of replaced by it. This still satisfies D.1's "if the subdomain or last-used tenant is known" (a returning user never types it) without creating a dead end. Two adjacent defects fixed at the same time, both consequences of deriving state from the wrong source:
- The backdrop business name read from the live field value, so it re-rendered per keystroke and displayed partial input as the shop's name (a lone "J" on screen). It now reads a separate `rememberedSlug` that only changes on hydration or a successful sign-in — confirmed values only, never in-progress input.
- `auth-store.ts` seeded `businessSlug` from `localStorage` **at module scope**. That module is evaluated during SSR too, where `window` is undefined and the read returns `""`, so for any returning user the server's HTML and the client's first render disagreed — a real hydration mismatch that happened to be invisible because the only affected node was a conditionally-rendered input. Moved to an explicit `hydrateBusinessSlug()` action called from a mount effect, so both passes start from `""` and agree.

**Alternatives rejected:**
- *Keep hiding the field, but latch the decision at mount (`useState(() => !businessSlug)`).* Fixes the disappearing-while-typing symptom and leaves the unrecoverable-wrong-slug trap completely intact. The trap is the more serious half.
- *Hide the field but add a "switch business" link to reveal it.* More UI to fix a problem that only exists because the field was hidden in the first place; a prefilled input already communicates "this is remembered, and you can change it" without inventing a second control.

**How this shipped in the first place, and what changed:** `Shutter.tsx` had no component test at all — the e2e suite covers the *mock* branch, where this field never renders, so the entire real-API login form was untested at every level. Every check that passed against it (the per-box browser login pass, the deploy-time assertions) drove the form programmatically via `fill()`, which sets a value in one shot and never reproduces the per-keystroke re-render that *is* the bug. Added `Shutter.test.tsx` covering all four behaviours, and confirmed the tests fail against the old condition rather than assuming they would — a regression test never run against the bug it describes is only decoration. Also added a `ResizeObserver` no-op to `vitest.setup.ts`: jsdom ships no layout engine, and several Radix primitives construct one in a layout effect, so rendering any component containing a Radix `Checkbox` threw before the first assertion.

**How to apply:** never derive a "should this input exist" condition from that input's own value — latch it at mount or, better, don't make the input conditional. Any state restored from `localStorage`/`sessionStorage` for a component that server-renders must be read in an effect after mount, never at module scope or in a store initializer, or the first client render silently disagrees with the server's HTML. And when a real user reports a UI defect a programmatic browser test passed over, check whether the test drove the UI the way a person does: `fill()` is not typing.

---

## 2026-08-21 — The import preview validated uploads against the demo catalog on a real backend

**Found by:** uploading a genuine trial stock file to the live site. Four of forty rows came back "Duplicate SKU or name (in this file or already in your catalog)" against a business whose product catalog was empty.

**What was wrong:** `lib/api/products.ts::buildImportPreview` sourced its "already in your catalog" set from `getDb()` — the in-memory **mock** store — with no `USE_MOCK_API` branch, and its docstring asserted that was fine ("Pure local computation, no API call — unchanged by USE_MOCK_API either way"). `getDb()` is not gated either, so against a real backend the preview compared every uploaded row to `lib/mock/seed.ts`'s eighteen demo products. Any product resembling demo data was declared a duplicate of something the business had never had.

**Why it mattered more than a misleading label:** `commitImport` forwards each row's `is_duplicate` to `POST /api/v1/products/import/commit`, and `products_import.py::commit_import` skips every row carrying it (`if row.errors or row.is_duplicate or not row.name: skipped += 1; continue`). The fabricated flag therefore propagated into the real import and silently dropped those products. The API reports them in `skipped`, which the UI does not surface — it reports only `created` — so on a real inventory upload, products would go missing with no visible error at all. On a system of record for stock, that is a data-integrity bug, not a cosmetic one.

**Decision:** in real mode the preview checks only what a client can genuinely know — duplicates **within the uploaded file**. Catalog duplicates are left to the backend, which already re-queries live `Product.sku`/`Product.name` at commit precisely because "time may have passed between preview and commit". Mock mode keeps checking the mock catalog, which is the correct catalog *for* mock mode. Narrows what the preview claims to know rather than switching detection off.

**Alternatives rejected:**
- *Call the real `POST /api/v1/products/import/preview` endpoint, which exists and does full server-side validation including real duplicates.* The genuinely complete fix and the right eventual shape — the backend returns per-row errors computed against live data. Not done here because `buildImportPreview` is synchronous and consumed inside a `useMemo` in `CsvImporter.tsx`; making it async pulls in loading and error states for the preview pane, a materially larger change than the one that stops real data being dropped. Recorded as the follow-up, with the endpoint named.
- *Leave the mock lookup and just relabel the message.* Rejected outright — the flag is not merely displayed, it is transmitted and acted on by the API.

**Adjacent gaps found, deliberately not fixed here:** the importer's client-side rules diverge from the backend's — the preview requires a SKU on every row while `product_import.py::REQUIRED_COLUMNS` is `["name"]` alone, so the UI refuses files the API would accept. And `CsvImporter` discards the API's `skipped` count, which is what made this bug invisible in the first place: an import that drops rows currently looks identical to one that doesn't. Both are worth closing; neither is a data-integrity issue on its own.

**How to apply:** `USE_MOCK_API` guards the *network* branches in `lib/api/*.ts`, but any helper reaching into `getDb()` is reading mock data whether or not it makes an API call — a function can be "pure local computation" and still be wrong against a real backend, because the local data it computes over is fake. Grep for `getDb()` outside a `USE_MOCK_API` branch when auditing this boundary. And note the shape of the failure: the preview was not merely *showing* something wrong, it was *feeding* it to an API that trusted it. Client-computed validation flags that a server acts on need the same scrutiny as any other untrusted input.

---

## 2026-08-22 — Every real API call sent a location_id that did not exist

**Found by:** clicking "Open the shop" on the live site. Nothing happened — no error, no spinner, no state change.

**What was wrong:** `lib/api/config.ts` exported `DEFAULT_LOCATION_ID = "loc-nyabugogo"` — the id of the *mock seed's* only location — and roughly twenty-five real-API call sites across `day`, `sales`, `stock`, `cashbox`, `debt`, `expenses`, `momo`, `products` and `till` sent it as the `location_id` on live requests. A real business's locations are server-generated UUIDs; no row with that id exists in any real tenant. The constant's own comment described this as making mock and real "point at 'the same' place conceptually", which is exactly the reasoning that hid it: the two id-spaces are not the same space at all.

Confirmed from the production API log rather than inferred:

```
asyncpg.exceptions.ForeignKeyViolationError: insert or update on table
"day_sessions" violates foreign key constraint "day_sessions_location_id_fkey"
DETAIL:  Key is not present in table "locations".
INFO: "POST /api/v1/day/open HTTP/1.1" 500 Internal Server Error
```

`GET /day/status` returned `200 null` for the same bogus id (no matching row is a legitimate "never opened"), so the UI cheerfully rendered the open-the-shop prompt and only failed on submit — and the mutation's rejection was never surfaced, so the button appeared inert. Opening the shop was impossible in production, and with it everything gated behind an open day: sales, till, stock movements, expenses.

**Decision:** resolve the location from the backend. `getDefaultLocationId()` returns the mock constant in mock mode and, against a real backend, the first entry of `GET /api/v1/users/me`'s `location_ids`, cached per session. Verified end-to-end before writing the fix: the same `POST /day/open` that returned 500 with `loc-nyabugogo` returns **201** with the user's real location id. The cache is cleared on sign-in and sign-out — a location cached from a previous session belongs to a different business, and on a multi-tenant system that is a cross-tenant leak, not just a stale value.

**Alternatives rejected:**
- *`GET /api/v1/stock/locations`.* The obvious-sounding source, and wrong: it returns `ProductLocationOut[]` — per-product stock rows — so it is empty for a business with no products yet, which is precisely the state a new tenant is in when it first tries to open the shop.
- *Fall back to the constant when `/users/me` has no location.* Rejected — that converts a clear, explainable failure into a foreign-key violation several calls later with nothing pointing at the cause. It now throws a message naming the actual problem.
- *Add a location-switcher UI.* The real long-term answer for multi-location businesses, but a much larger piece of product work; "the signed-in user's first location" is the honest single-location behaviour the app already assumed, just sourced correctly.

**Still open, and the reason this was invisible:** the failed mutation surfaced nothing to the user. `useOpenDay`'s error state isn't rendered, so a 500 and a successful no-op are indistinguishable at the UI. That is the deeper defect — this bug was findable only by opening devtools — and it is worth fixing before the next one hides the same way. Not addressed here.

**How to apply:** an identifier that is *valid in mock data* is not thereby valid against a real backend, no matter how conceptually equivalent the two seem — mock ids are a different namespace, and a constant that crosses that boundary will always be wrong on one side of it. When a UI action does nothing at all, check the network tab before the component: an unrendered mutation error looks exactly like a dead button.

---

## 2026-08-22 — A guard on the mock/real boundary, because three incidents in a row came through it

**The pattern, not the bugs:** three production failures in quick succession were the same defect wearing different clothes.

1. `DEFAULT_LOCATION_ID` ("loc-nyabugogo") went out as a real `location_id`; `POST /day/open` died on a foreign key and opening the shop was impossible.
2. `buildImportPreview` compared real uploads to the mock seed catalog, flagged rows as duplicates of products the business never had, and — because `commitImport` forwards `is_duplicate` and the API skips those rows — silently dropped them from a real import.
3. `commitImport` itself once wrote to the mock store regardless of mode.

In every case `USE_MOCK_API` correctly guarded the *network* branch. Nothing guarded the *data*. A function can take the real code path and still compute over fake values, and that is invisible to types, to tests that run in mock mode, and to any smoke check that only asks whether a request 200s.

**Decision:** enforce the boundary statically, in `apps/web/scripts/check-no-mock-in-real-paths.mjs`, wired into `npm run lint` so CI fails on it. Three rules:
- **A** — only `lib/api/**` and `lib/mock/**` may import from `lib/mock/`. UI code reaching into mock data is never correct in production.
- **B** — inside `lib/api/**`, an *exported* function touching mock state (`store.`, `getDb(`, or any mock-only identifier) must mention `USE_MOCK_API`.
- **C** — mock-only identifiers (`DEFAULT_LOCATION_ID`, `DEMO_MANAGER_PIN`, the seed's `LOCATION_*`, `CURRENT_USER_*`) must not appear anywhere outside those two layers.

Verified the guard by reintroducing two of the historical bugs and confirming it fails on each, rather than trusting a green run on already-fixed code.

**What the sweep then found and fixed, beyond the known three:**
- `components/stock/TransfersTab.tsx` imported `LOCATION_ID`/`LOCATION_ID_2` from the mock seed and sent them to the real transfer endpoint — the identical foreign-key failure as day-open, still latent. It also *rendered* the demo branch names ("Nyabugogo → Kimironko") as button text to businesses that have neither. Locations now come from `listTransferLocations()` in the API layer, which is honestly `notSupportedByBackend` against a real backend: no endpoint lists a business's locations by name (`GET /stock/locations` returns per-product stock rows, empty for a new business; `GET /users/me` gives ids without names). The tab now says so instead of offering a transfer it cannot construct.
- `DEMO_MANAGER_PIN` ("9999") was compared directly in three components to approve over-threshold discounts, credit-limit overrides and back-dated payments. The backend enforces this properly — `_verify_manager_override`, rate-limited — but requires a manager *user id* alongside the PIN, and `sales.ts` always sends `manager_override_user_id: null`, so the check returns False and the sale comes back 422. The UI said "approved" and the server then refused, with nothing connecting the two for the user. The constant moved into `lib/mock/seed.ts` and the branch into `lib/api/manager-override.ts`, which approves in mock mode and in real mode returns a message naming the actual limitation.

**Alternatives rejected:**
- *Delete the mock layer.* It is what makes the e2e suite runnable with no backend and the design work possible offline; the problem was never its existence, only its reachability.
- *Rely on review and discipline.* Three incidents in three days, each caught by a person clicking the live site rather than by anyone reading the diff, is the evidence against that.
- *Flag every function touching mock state, not just exported ones.* Produced false positives on genuinely mock-only private helpers (`computeOverview`, `applyFilters`). A check that cries wolf gets switched off, which protects nothing — the exported-function rule covers the boundary that actually leaks. The limitation is written into the script's header rather than left for someone to rediscover.

**Known limit, stated plainly:** a module-private helper called from an exported function's *real* branch would still slip through, and no static rule catches a real endpoint returning data the UI then misinterprets. This narrows a specific, repeatedly-demonstrated failure mode; it does not make mock contamination impossible.

**How to apply:** when adding anything to `lib/api/*.ts`, the mock branch may read mock data and the real branch may not — the guard enforces it, but the reasoning matters more than the rule: an identifier that is valid in the mock layer is in a *different namespace* from the real backend's, however equivalent the two look. If a value's only definition lives in `lib/mock/`, it cannot legally reach a request.

---

## 2026-08-22 — Failed requests now say so, and manager approval actually works

**Decision 1 — every failed request is visible.** Errors were captured into per-hook `isError` state that almost nothing rendered, so a 500 and a successful no-op looked identical: "Open the shop" sat there like an inert button while the server returned a foreign-key error on every click, and every bug in this log was found by a person with devtools open rather than by the app saying anything. Handled once on the React Query cache in `app/providers.tsx` — `MutationCache.onError` and `QueryCache.onError` push a toast — rather than in each of the ~40 mutation hooks, because a global handler cannot be forgotten at a new call site, and forgetting is exactly how this kept happening. `ToastViewport` moved from individual pages into `Providers` so an error raised anywhere has somewhere to appear.

`describeApiError` turns the raw thrown value into one actionable sentence: `apiRequest` throws `ApiError(rawBody, status)` and the raw body is FastAPI JSON (`{"detail": ...}`, or a validation array), which is barely better than silence. Query errors with status 501 are deliberately not toasted — `notSupportedByBackend` marks disclosed gaps whose screens render their own explanation, and toasting them on every page load would be the noise that gets error surfacing switched off again. Mutations always toast: the user just did something.

**Decision 2 — manager approval works instead of pretending to.** `sales.ts` hard-coded `manager_override_user_id: null`, and `_verify_manager_override` returns False without both a manager id and a PIN, so *every* over-threshold discount was rejected 422 by the real backend while appearing to succeed against the mock. The frontend had no way to fix this alone: it captured a PIN but never which manager entered it, and `GET /api/v1/users` requires `user.manage`, which cashiers deliberately lack.

So apps/api grew `GET /api/v1/users/approvers?capability=...`: authenticated but not capability-gated (a cashier must be able to see who to ask), returning only `id` and `display_name` — no phone, email, or role — for active users in the caller's own business holding that one capability, with the capability validated against `CAPABILITIES` so it can't be used to probe arbitrary strings. Tested for exactly that narrow shape, for 401 unauthenticated, 422 on an unknown capability, and for cross-tenant isolation. The Counter now asks who is approving, and the id travels with the PIN through `basket-store` → `RecordSaleInput` → the sale. The PIN is no longer checked client-side at all in real mode — it is verified server-side against that manager's stored hash, rate-limited, which is the only place it can be verified.

**Decision 3 — a flaky test fixed rather than retried.** `test_pay_link_flipped_signature_byte_is_rejected` failed in a full run and passed in isolation. Not load or ordering: an HS256 signature is 256 bits carried in 43 base64url characters — 258 bits of capacity — so the final character's low 2 bits are padding that decoders ignore, and several distinct final characters decode to byte-identical signatures. Rewriting the last character to "A" therefore left the token genuinely valid roughly one run in sixteen, and the endpoint was right to accept it. Now flips the first character, where every bit is significant. Confirmed with five consecutive passes.

**How to apply:** a mutation that can fail must have somewhere to say so before it ships — if the only way to observe a failure is the network tab, the feature is not finished. And when a client-side check "approves" something a server will independently decide, the check is decoration: either send what the server needs to make the real decision, or say plainly that the action isn't available.

---

## 2026-08-22 — A brand-new business had no units, so it could not hold stock at all

**Found by:** running the reported CSV import against a freshly-created business. Forty valid rows, zero products created.

**What was wrong:** `create_business` seeded roles, permissions, a location and an owner — but no units of measure. Every `Product` requires a `base_unit_id`, so a business with no units cannot hold stock at all. `commitImport` computes `default_unit_id` as `[...unitNameById.keys()][0] ?? ""`, `GET /products/units` returns `[]` on a new business, and the API correctly rejects the empty id with `422 Unknown default_unit_id.` — which, before global error surfacing landed, the user never saw. The import simply appeared to do nothing.

This is the same shape as the location bug: an identifier the frontend was structurally unable to supply, failing on the server, invisibly.

**Decision:** `seed_default_units` creates the six units the app's own vocabulary already assumes (`piece`, `bag`, `kg`, `litre`, `box`, `carton` — the same set as `lib/mock/seed.ts`'s `UNITS`) whenever a business is created. A shop can rename or add to them; it must not start with none. `tests/conftest.py` now uses that shared seeder instead of hand-rolling its own `piece` unit, which is the entire stated purpose of `operatoros_api.seed` — a fixture tenant should never be subtly different from what a real new business gets, and here it was: the fixtures had a unit, so no test could reproduce what every real signup hit.

Also gives `commitImport` an explicit failure for the no-units case rather than sending `""` and relaying a bare "Unknown default_unit_id." to a shopkeeper.

**Alternatives rejected:**
- *Have the importer create a unit on the fly.* Silently inventing reference data during a bulk upload is how a catalogue ends up with three different spellings of "piece". Units are business-level setup, and the fix belongs where the business is created.
- *Ask the user to pick a unit in the import screen.* Worth having eventually, but it does not fix the underlying state — a business with no units is broken for single-product creation too, not only for imports.

**How to apply:** when adding anything a record structurally requires (a unit, a location, a category), check what a *brand-new* tenant actually has, not what the test fixtures have. The two drifted here precisely because the fixtures were built by hand, and that difference hid a bug every real signup would hit on day one.

---

## 2026-08-22 — Deleting a business needs the projection guards stood down, briefly

**Found by:** cleaning up demo tenants. `DELETE FROM businesses` failed with `Direct writes to money_location_balance are not allowed; write through the projection framework.`

**Why:** every tenant table cascades from `businesses.id`, but the event-sourced projection tables carry a `reject_direct_projection_write()` trigger, and a foreign-key cascade issues an ordinary `DELETE` that the trigger correctly refuses. The guard is doing its job — a projection must only ever be rebuilt from events — it simply also catches the one legitimate case where a projection row should disappear because its whole tenant is going.

**Decision:** `apps/api/scripts/delete_business.py`, rather than another ad-hoc one-liner. It disables the guard triggers, deletes, and re-enables them, all inside one transaction — Postgres DDL is transactional, so a failure rolls the re-enable back with everything else and there is no path that leaves the guards switched off. The guarded tables are discovered from `pg_trigger` by function name rather than hard-coded, so a projection added later is covered without anyone remembering this file exists. Requires `OPERATOROS_DATABASE_URL_MIGRATE`: the app's own role has no `DELETE` grant on `businesses`, which is deliberate and stays that way. Prompts for typed confirmation unless `--yes`.

**Alternatives rejected:**
- *`SET session_replication_role = replica`.* Disables user triggers, but also the FK triggers that perform the cascade — the delete would then fail on the first referencing row instead.
- *Drop the projection guard.* It is one of the few things preventing a projection from silently diverging from its event stream. A tenant deletion is rare and administrative; the guard protects every ordinary write.
- *Grant the app role `DELETE` on `businesses` and expose an endpoint.* Deleting a tenant and everything it owns should not be reachable from the running application at all.

**How to apply:** `.venv/bin/python scripts/delete_business.py --keep <slug>` (or list slugs to remove) with the migrate credential in the environment. Anything that cascades into a projection table hits this same wall — reach for this script rather than re-deriving the trigger dance.

---

## 2026-08-22 — The setup wizard could lock a tenant out of their own shop

**Found by:** a report from the live site. "Fitting out the shop", step 6, clicking *Open the shop* raised the toast **"The shop is already open at this location."** and went no further. No forward, no back, no dismissal.

**What was wrong:** the wizard's `completed` flag lives in this browser — there is no onboarding endpoint to put it behind (see `lib/api/onboarding.ts`) — but the thing it gates on, the shop being open, lives on the server. Nothing reconciled the two, and the failure mode when they disagreed was total:

1. A browser that had lost its flag (cleared storage, another device, another browser) put a fully fitted-out shop back at step 1.
2. The wizard's only exit is *Open the shop*, and `POST /api/v1/day/open` answers `409` for a day that is already open — correctly; a day must not be opened twice.
3. So the exit was closed. *Not yet* returned to the same screen.

Two things kept it from self-correcting. `Onboarding` carried a second copy of the decision — an effect keyed only on `[day?.status]` — so when the day was *already* open on arrival the status never changed, the effect never fired, and the wizard never noticed it was finished. And completion was chained off `save.mutateAsync(...).then(onFinish)`, so a failed write to browser storage also stranded the tenant in a wizard they had actually completed.

The flag was one flat key shared by every business signed in on the device, which broke the same seam in the other direction: a brand-new business inherited the previous one's finished wizard and skipped setup entirely — no products, no staff, no opening balances, straight onto an empty shop floor.

**Decision:** **server truth decides, in exactly one place.** `useOnboardingGate()` (`lib/queries/onboarding.ts`) owns "is this shop fitted out?", and answers `completed || day.status === "open"`. Opening the day is the wizard's last action, so an open day is proof the wizard finished no matter what the browser remembers. The flag is written back rather than merely inferred, so it is still true tonight once the day is closed again. `Onboarding`'s rival copy of the decision is deleted — the component no longer reads day status at all.

Three supporting changes:
- `openDay()` reconciles a `409` by adopting the session the server already has. A second tab, a second device, or a double-submit reaches the state the caller wanted; reporting a failure the shopkeeper cannot act on is worse than useless when nothing in the app can clear an open day except closing it. Only reconciles when a day really is open — the endpoint's other `409` (an `Idempotency-Key` reused for a different body) still surfaces.
- Onboarding state is keyed per business slug, with a one-time migration off the shared key.
- `useDayStatus` is gated on `signedIn`, because the gate runs on `app/page.tsx` before the Shutter is cleared and an unauthenticated day fetch is a guaranteed 401 — which, now that failures surface globally, would land as an error toast on the login screen.

**Alternatives rejected:**
- *Give the wizard a "skip setup" escape hatch.* Papers over the disagreement and leaves the app's two halves believing different things. It also puts the burden on the shopkeeper to know that the wizard is wrong.
- *Fix the effect's dependency array and stop there.* Repairs this instance and leaves the structure that produced it: two components independently deciding the same thing, which is how the stale-dependency bug survived review in the first place.
- *Treat 409 as success unconditionally.* Would swallow the idempotency-key conflict, which is a real client bug worth seeing.
- *Persist onboarding server-side.* The right answer, and still an open gap — it needs an endpoint that does not exist. The gate makes the browser-local flag safe to be wrong, which is what unblocks the tenant today.

**How to apply:** when browser state gates on server state, name which one wins and reconcile in one place. Two components deriving the same conclusion from the same data is not redundancy — it is a second copy that can rot, and this one rotted into a lockout. And any endpoint that refuses an action *because it is already done* needs the caller to treat that as the goal reached, not as an error: check every `409` for whether the user's intent is already satisfied.

**Decision 2 — the wizard stops claiming it saved things it didn't.** Checking the reported business against the database turned up something the lockout was hiding. There is exactly one tenant, `demo-c6ed09` / "Kigali Hardware Demo", with a day open since 10:22 UTC — no business named "KAGARAMA HARDWARE" exists at all, even though the summary card displayed it. The trading name is wizard state; it renames nothing.

The same is true of steps 4 and 5. `state.staff`, `state.openingBalances.debtors` and `.payables` are read by no `lib/api` function anywhere — they reach `localStorage` and stop. That the mechanism is a stand-in is disclosed (known gaps #16); the screens asserting otherwise was not. Step 5 said *"without it, the Debt Book starts empty on day one"* and then let the Debt Book start empty, and the summary reported "2 staff invited" and "1 opening debtors recorded" for an invite never sent and a debt never posted.

Only the product count was ever true — the CSV/XLSX importer writes real products.

This is a money-correctness problem, not a copy nit: a shopkeeper who believes their debtors are on the books stops chasing them from their old record, and the debt quietly ages out. Every step whose input stops in the browser now says so next to the fields (`KeptOnThisDevice`), the summary distinguishes "noted" from saved, and the false promise of a WhatsApp invite is gone.

**Alternatives rejected:**
- *Wire the steps up instead.* The right fix and much larger than a copy change: renaming a business, creating staff accounts with PIN-setup delivery, and posting opening debtor balances as real ledger entries are three separate features, and supplier payables have no backend at all before Phase 3. Worth scheduling; not worth leaving the app lying in the meantime.
- *Remove the steps.* The information is genuinely useful to collect, and a shop that has written its debtors down once will migrate faster when the books can take them.

**How to apply:** a form that discards its input is worse than no form, because it buys false confidence — and the cost lands on whoever trusted it. If a field has nowhere to go yet, say so beside the field, in the same screen, before the user commits work to it.

---

## 2026-08-22 — Every real tenant saw the demo shop's name above their own till

**Found by:** driving the live site with Playwright to confirm the setup-lockout fix. The assertion printed the page's own text, and the top bar read *"Kigali Hardware Supplies · Nyabugogo branch"* — while the database holds exactly one tenant, `demo-c6ed09` / **"Kigali Hardware Demo"**, whose only location is not named Nyabugogo.

**What was wrong:** three literals in `TopNav`.

```tsx
export function TopNav({ businessName = "Kigali Hardware Supplies", ... })   // ShopFloor never passed one
  …"Nyabugogo branch ▾"…                                                     // hard-coded
  …>AM</button>                                                              // hard-coded initials
```

All three are the mock fixture's values, and they had been on every screen of every real session since the backend went live. For a multi-tenant business-ops product this is worse than cosmetic: the name above the till is how a shopkeeper confirms they are in *their* books, and it was someone else's.

The reason it was written that way is that the frontend genuinely had nothing else to render. No route returned a business name, and `GET /stock/locations` returns per-product stock rows — empty for a business with no products — so a location id could not be turned into a branch name either. That second gap was already disclosed (`stock.ts::listTransferLocations`, known gaps); the first was not.

**Decision:** `MeOut` carries `business_name` and a named `locations` list. Both come from rows the endpoint already had in scope, add no permission surface (you can only ever read your own session), and are covered by a cross-tenant test asserting two tenants get their own names. `lib/api/identity.ts` is the single place the UI reads any of it, initials derived from the real `display_name`. `listTransferLocations` stops throwing 501 and answers from the same field.

**And a fourth guard rule, because the existing three could not have caught this.** Rules A–C all track *imports and identifiers*; `TopNav` defeated every one of them by simply typing the strings in. Rule D reads the fixture's name constants out of `lib/mock/seed.ts` at check time and fails on any file that hard-codes their values. Validated by reintroducing the bug — it fails — and it immediately found two more copies in `products.ts` that had been sitting there unnoticed.

Rule D also exposed a bug in the guard itself: `globSync` yields `e2e\helpers.ts` on Windows, so `startsWith("e2e/")` was false and the e2e suite was in scope locally but not in CI. Paths are normalised before filtering now.

**Alternatives rejected:**
- *Title-case the business slug.* Already done for the Shutter backdrop, and it produces "Demo C6Ed09". Fine as a placeholder behind a login form; not fine as the name a shop reads all day.
- *Leave the branch button hard-coded because it isn't wired up yet.* An inert control showing a branch the business does not own is a lie about their own data. It renders the real branch, or nothing.

**How to apply:** when a component needs a value the API cannot supply, the answer is to extend the API, not to type in a plausible-looking constant. A default prop is the most dangerous form of this — it looks like configuration, so nobody reads it as a hard-coded value, and no caller has to opt in for it to ship.

**Decision 2 — a refresh no longer throws away a live session.** `signedIn` lives in memory, and nothing ever restored it, so pressing F5 mid-day returned the shopkeeper to the Shutter for a full phone + PIN + TOTP round trip while perfectly valid httpOnly cookies sat in the jar. The tokens are unreadable from JS by design, so the only way to know is to ask: `restoreSession()` calls `GET /api/v1/users/me` once on mount and trusts the answer. It fails closed — a 401, a network error, or mock mode all leave `signedIn` false, exactly as before — so it can only ever restore a session the server itself vouches for. The Shutter holds on "Opening up…" while the check is in flight rather than flashing a login form at someone who is already signed in.

**Decision 3 — CI now runs on `main`.** `ruff` and `black` had been failing on `main` for several commits with nothing to report it: `ci.yml` triggered only on pull requests and the old `rebuild/phase-0` branch, while `deploy.yml` fires on every push to `main`. Work has been reaching the live boxes with no gate having an opinion about it. Adding `main` to the push triggers makes the drift visible immediately. It does **not** yet block the deploy — both workflows still trigger independently on the same push, so a red CI run and a green deploy can coexist. Gating deploy on CI (`workflow_run`, or a `needs:` prerequisite) is the right follow-up and is deliberately not bundled into a hotfix: getting it wrong breaks the ability to ship at all.
