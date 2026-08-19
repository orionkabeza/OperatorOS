# Phase 0 — Foundations (plan)

**Status:** AWAITING APPROVAL. No code will be written until this is approved.
**Spec refs:** Part E (ledger), Part F (permissions), Part G.1 (security), Part B (design system), Part H Phase 0.
**Goal of Phase 0:** the *spine* is correct and tested — sign in through the Shutter, land on an empty Shop Floor shell with a live (empty) Tally Rail, and I can show you passing tests proving tenant isolation, event-ledger integrity, and idempotency, plus a `/design` route to review the visual direction. Nothing else user-facing.

---

## 0. Decisions I need from you before I start

These are the points where the spec/brief is silent or conflicts with reality. Per our working agreement I will not guess on any of them.

### 0.1 Repo strategy vs. the live deployment (blocking)
The repo root today **is** the old Next.js owner-dashboard, and it is *live* at `operatoros.orion-labs.dev`, auto-deployed by `.github/workflows/deploy.yml` on every push to `main`. The new architecture is a monorepo (`apps/api`, `apps/web`, `packages/shared`) on a completely different stack (FastAPI + Postgres event ledger). These cannot both own the repo root cleanly.

**My recommendation — Option A:** develop Phase 0 on a long-lived branch `rebuild/phase-0`, and in that branch move the old app into `legacy/` (kept for reference only, per your brief) and stand the monorepo up at root. `main` stays deployable to the live box until we deliberately cut over. The old CD workflow keeps working off `main`; we add a *new* CI (lint/type/test/SAST/secret-scan) that runs on the rebuild branch and PRs. We do the production cutover as its own decision at the end of Phase 1 (when there's a sellable POS), not now.

- Option B: nuke the old app from `main` now, accept the live site breaks/goes stale. (Faster, but you lose the live demo with no replacement for weeks.)
- Option C: separate new repo entirely. (Cleanest isolation; loses shared history and your existing CI/secrets/infra memory.)

I recommend **A**. Confirm or redirect.

### 0.2 The prototype — correction, this was wrong earlier
**Correction:** an earlier version of this plan said `prototype.html` didn't exist. That was wrong — it's at the repo root (41KB, `<title>OperatorOS — Shop Floor prototype</title>`), and my initial `Glob` search simply failed to find a file that was already on disk (confirmed after the fact via `git status`/`ls`, and the discrepancy reproduced on a second `Glob` call — a tool-reliability issue worth being aware of, not a reason to trust a "not found" result from it alone next time). Sorry for the bad premise in the original plan — flagging it rather than quietly editing it away.

Having now actually opened and driven it (Playwright: sign-in flow filled and submitted, Counter product grid confirmed rendering, zero console errors): it's real and matches Part B closely — the Shutter (slat texture, keyhole card, PIN boxes, raise animation), the Tally Rail, and a working Counter with category rail + product grid + basket, plus a Back Office → Analytics panel (KPI band, trend chart, product performance, cash flow — matching D.10.2). Stock Room / Debt Book / Cash Box / Suppliers / Team are stubs in it. This is exactly the reference the brief describes, and it resolves this blocker: for Phase 0, the Shutter and Tally Rail should be matched to it pixel-for-pixel wherever Part B underspecifies something, not just built from the written tokens as I'd proposed as a fallback.

Separately, `design-reference/debt-book-stock-room.dc.html` (imported from Design MCP, verified via an 8-screen Playwright click-through, zero console errors) now covers Debt Book and Stock Room in the same spirit — see `docs/DECISIONS.md` for why it lives outside `apps/web` rather than being built into the app now (short version: those rooms are Phase 1/Phase 2 work needing their own approved plans and the event ledger first; nothing here changes Phase 0 scope).

### 0.3 Currency in the seed/demo tenant
Spec uses `RWF` (no minor unit shown to users) but mandates BIGINT minor units stored ×100 (E.5). I'll store ×100 internally and render whole RWF via `<Money>`. Confirming this is what you want (vs. storing ×1 for RWF specifically) — I recommend ×100 as the spec says, for currency-change and percentage-math safety.

### 0.4 2FA delivery channel for Phase 0
Spec mandates TOTP 2FA for Owner/Manager/Bookkeeper (G.1), and the Shutter also references SMS/WhatsApp codes (D.1). For Phase 0 I propose implementing **TOTP only** (authenticator app — no external dependency, fully testable offline), and stubbing the SMS/WhatsApp OTP path behind an interface to fill in Phase 2/5 when the WhatsApp surface is built. Confirm.

### 0.5 Hosting target for the new stack
The current infra is a hand-rolled systemd/nginx/HAProxy setup for a Node app. The new stack needs Postgres 16 + Redis + a Python ASGI app + a Next app. Phase 0 delivers **Docker Compose for local only** (per the brief). Production infra for the new stack is out of scope for Phase 0 and will be its own plan. Just confirming we are *not* touching the live boxes during Phase 0.

---

## 1. Repo & tooling

**What I'll build**
- Monorepo layout:
  ```
  apps/api        FastAPI + SQLAlchemy 2.x + Alembic + Pydantic v2 + Celery
  apps/web        Next.js 14 App Router, TS strict, TanStack Query, Zustand, Tailwind
  packages/shared OpenAPI-generated TS types + Zod schemas, shared design tokens, i18n message catalogues
  docs/           plans/, DECISIONS.md, RUNBOOK.md
  infra/          docker-compose.yml, Dockerfiles, .env.example
  ```
- **Docker Compose** services: `postgres:16`, `redis:7`, `api` (uvicorn), `worker` (celery), `web` (next dev). Everything env-var configured; no secrets committed — `.env.example` documents every var, real `.env` gitignored.
- **Makefile** targets: `dev`, `test`, `lint`, `typecheck`, `migrate`, `seed`, `fmt`.
- **CI** (new workflow, runs on PRs + the rebuild branch): ruff + black + mypy (api), eslint + tsc + vitest (web), pytest (api), **SAST** (bandit + semgrep), **dependency scan** (pip-audit + npm audit / osv-scanner), **secret scanning** (gitleaks). Build fails on any.
- Lint rules that are *product requirements*, not style:
  - **No floats for money** — a custom lint/CI check (grep-gate + mypy `NewType('Minor', int)`) failing the build if a money value is a float anywhere in the stack.
  - **No arbitrary Tailwind values** — eslint rule blocking `text-[#hex]` / `p-[13px]`; only design tokens allowed.

**Files:** `pyproject.toml`, `apps/api/**`, `apps/web/package.json`, `infra/docker-compose.yml`, `Makefile`, `.github/workflows/ci.yml`, root `package.json` (workspaces).

**Tests:** CI green on an empty-but-wired repo (a trivial passing test in each package proves the harness runs).

---

## 2. Tenancy & auth

**Data model (entity tables, all with `business_id NOT NULL` except `businesses` itself):**
`businesses`, `locations`, `users`, `roles`, `permissions`, `role_permissions`, `user_locations`, `user_grants` (per-user layered grant/revoke), `device_sessions`, `refresh_tokens`, `login_attempts`.

**RLS — the core control (E.4, G.1):**
- RLS `ENABLE` + `FORCE` on every tenant table.
- Policy binds `business_id` to a session GUC `app.business_id`, set per-request from the **verified JWT**, inside a request-scoped SQLAlchemy dependency, in the same connection/transaction. Never from a request parameter.
- The app DB role is non-superuser and non-`BYPASSRLS`, so a forgotten `WHERE` cannot leak across tenants.
- Location scoping (F.2) layered as a second GUC `app.location_ids` where capabilities are location-scoped.

**Auth (G.1):**
- **Argon2id** for passwords and PINs (PIN mode per D.1 — 6-digit, trivial-sequence blocklist).
- Access tokens 15 min; **rotating refresh tokens** bound to a device; **reuse detection** revokes the whole token family.
- **TOTP 2FA** (mandatory Owner/Manager/Bookkeeper). SMS/WhatsApp OTP stubbed behind an interface (see 0.4).
- Rate limiting (per IP + per identifier) and lockout (D.1: 3 attempts → 15-min device lock), backed by Redis. No user enumeration — identical message + timing for unknown-identifier vs wrong-PIN.
- Cookies: `HttpOnly`, `Secure`, `SameSite=Lax`, 12h idle / 30d absolute with the trust-device option.

**Capabilities (F.2):** granular capability registry (`sale.create`, `product.view_cost`, `debt.write_off`, `data.export`, `user.manage`, `day.reopen`, …); roles are bundles; enforced **server-side on every request** via a FastAPI dependency, independent of RLS.

**The cross-tenant test suite (the build-failing one, G.1):** a parametrised pytest suite that, for **every registered route**, authenticates as tenant A and attempts to read and mutate tenant B's ids — asserts 403/404/empty, and the suite auto-discovers routes so a new endpoint added without isolation fails CI.

---

## 3. The event ledger

**`events` table (Part E.2 envelope, exactly):** uuid v7 id, `business_id`, `location_id`, `type`, `payload jsonb`, `occurred_at`, `recorded_at`, `actor_user_id`, `actor_source`, `device_id`, `correlation_id`, `reverses_event_id`, `corrects_event_id`, `schema_version`. **Partitioned by month**; indexes `(business_id, occurred_at)` and `(business_id, type, occurred_at)` (G.2).

**Typed event registry:** one Pydantic v2 payload schema per event type (the E.2 initial set), versioned (`schema_version`), with `extra="forbid"`. Append API validates envelope + payload against the registry before write.

**Projection framework (E.3):**
- Projections (`product_stock`, `customer_balance`, `supplier_balance`, `money_location_balance`, `daily_totals`, `staff_daily_totals`, `product_daily_movement`) updated **in the same transaction** as the event append.
- **DB trigger** rejecting direct writes to projection tables from outside the projection role/path (E.1 enforcement) — projections may only be mutated by the append layer.
- **Idempotency** (G.1): `idempotency_keys` table; every mutating endpoint takes an `Idempotency-Key` header, stores key+response 24h, replays the stored response.
- **Nightly projection-audit job** (Celery beat): recompute every projection from the event log, diff against live, alert on drift (E.3).

**Phase 0 scope note:** I'll implement the append API + framework + one real end-to-end projection (`money_location_balance` driven by a couple of test event types) to *prove* the machinery — the full per-feature event handlers land in their phases. No feature writes state except through append.

**Tests:** append rejects a bad envelope/payload; projection updates in-transaction and rolls back with the event on failure; direct projection write is rejected by the trigger; idempotency replay returns the identical response and writes no second event; the audit job detects an injected drift.

---

## 4. Design system

**Tokens → Tailwind (B.2–B.4):** palette, type scale, spacing scale (4/8/12/16/24/32/48/64/96), radius (2px, 0 for shutter/rail), shelf-shadow — all as the **only** available Tailwind values. Arbitrary-value lint rule (from §1) enforces it.

**Fonts (self-hosted, no CDN):** Archivo Expanded, Public Sans, IBM Plex Mono — `next/font/local`.

**Components built + documented in `/design` (B.6):** Button (Primary/Secondary/Danger/Ghost, all states incl. disabled-with-reason), Input (incl. money variant with `RWF` chip), **Money** and **Qty** (the single formatting components, tabular numerals — no ad-hoc number formatting anywhere), Table (sticky steel header, 44px rows, sort/filter/CSV/row-count, drawer-on-click), Drawer, Card (shelf shadow), Toast (never green), EmptyState, ConfirmDialog (typed-confirmation for high-value).

**Signature elements (B.5):**
- **The Shutter** sign-in — slat gradient, stencilled business name, keyhole card, roll-up animation (400ms `cubic-bezier(.22,.61,.36,1)`) with `prefers-reduced-motion` → 150ms fade.
- **The Tally Rail** — 56px steel strip, `TAKEN TODAY · ON CREDIT · IN THE TILL · LOW STOCK`, count-up animation, `--tape` underline for the active room. Empty/zero state for Phase 0.

**Accessibility (G.5):** keyboard operable, visible focus (incl. the `--ink` inner ring on yellow), 44px targets, `prefers-reduced-motion`, contrast verified for every token pair actually used, screen-reader labels. i18n: all strings externalised from day one (en/rw/fr catalogues; en complete, rw/fr scaffolded).

**Tests:** Vitest + Testing Library on Money/Qty formatting (incl. negatives in `--out`, no-decimal RWF, thousands separators) and Button disabled-reason; Playwright smoke of `/design`; an axe accessibility pass on `/design` and the Shutter.

---

## 5. App shell

- Top nav (56px steel): business name + **location switcher** (with live till balance per location, "All locations" consolidated mode, current location stamped onto events), global search scaffold (`⌘K` command palette shell), connection-state indicator (`Online`/`Offline`/`Syncing` — display only in Phase 0), notifications bell scaffold, user avatar menu.
- Room navigation (B.5.3): the seven rooms + Close the Shop, active `--tape` marker, collapsible to 64px icon rail, mobile bottom bar.
- Rooms render **placeholder EmptyStates** in Phase 0 (no room features yet).
- Auth-gated: unauthenticated → the Shutter.

**Tests:** Playwright e2e — sign in through the Shutter (incl. TOTP), land on the shell, Tally Rail present and empty, ⌘K opens the palette shell, location switcher renders.

---

## 6. Audit log

- **Hash-chained, append-only** `audit_log` (G.1): each row carries `prev_hash` + `hash` over its canonical content; tamper is detectable by re-walking the chain.
- Flowing in from day one: `LOGIN_SUCCEEDED`, `LOGIN_FAILED`, `ROLE_CHANGED`/`PERMISSION_OVERRIDDEN`, `DATA_EXPORTED`.
- Note: audit_log entries are distinct from ledger events, though login/permission events also exist in the event registry — the audit_log is the tamper-evident security record; the event ledger is the business system of record. DECISIONS.md will record why both exist.

**Tests:** chain verifies over a sequence; a mutated middle row fails verification; login success/failure writes an entry.

---

## 7. Definition of done for Phase 0 (from the brief)

- [ ] Repo/tooling/CI green (lint, types, tests, SAST, dep-scan, secret-scan)
- [ ] RLS on every table; cross-tenant test suite passes and fails the build if isolation is broken
- [ ] Event ledger: envelope enforced, projection in-transaction, direct-write trigger, idempotency, nightly audit — all tested
- [ ] Design system in `/design`; Shutter + Tally Rail per B.5; Money/Qty the only number formatters
- [ ] App shell: sign in through the Shutter → empty Shop Floor with live-empty Tally Rail
- [ ] Audit log hash-chained with login/permission/export flowing in
- [ ] `README.md` + `docs/RUNBOOK.md` let a new engineer run and operate it; `docs/DECISIONS.md` has an ADR line per non-obvious choice
- [ ] Accessibility floor met on everything built; strings externalised

## 8. Commit plan (small, reviewable, conventional commits)
`chore: scaffold monorepo + compose + CI` → `feat: tenancy schema + RLS + session GUC` → `feat: auth (argon2id, tokens, TOTP, lockout)` → `test: cross-tenant isolation suite` → `feat: event ledger envelope + append API` → `feat: projection framework + trigger + idempotency` → `feat: nightly projection audit job` → `feat: design tokens + fonts + core components` → `feat: shutter + tally rail` → `feat: app shell + rooms scaffold` → `feat: hash-chained audit log` → `docs: README + RUNBOOK + DECISIONS`.

---

**I will not write any code until you approve this plan (and answer §0).** On approval I'll start with §1 (repo scaffold) and the §0.1 branch strategy you pick.
