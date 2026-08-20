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
