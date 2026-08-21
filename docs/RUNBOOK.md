# Runbook

How to run and operate OperatorOS locally. Written so a new engineer can get moving without asking anyone.

## Frontend (`apps/web`)

### Prerequisites

- Node.js 20+ (developed against Node 24)
- From the repo root: `npm install` (this is an npm workspaces monorepo — `apps/web` and `packages/shared` are installed together from the root; don't run `npm install` inside `apps/web` alone)

### Run it

```
npm run dev:web
```

Opens on `http://localhost:3000` by default. Sign in at `/` with the demo credentials (see below); `/design` shows the full component library without needing to sign in.

**Demo sign-in is not real auth.** `apps/web/lib/demo-auth-store.ts` exists purely so the Shutter's states and the Shop Floor shell are visible before `apps/api`'s real auth (Argon2id, rotating refresh tokens, TOTP) exists and is wired up — see `docs/DECISIONS.md`. Demo credentials: phone `788 402 219`, PIN `142857`, 2FA code `000000`. That file must be deleted, not extended, once real auth lands.

### Checks

Run these before every commit — all four must be clean:

```
npm run typecheck:web
npm run lint:web          # next lint + no-arbitrary-Tailwind-value gate + generated-API-client freshness gate
npm run build:web
```

```
cd apps/web
npm run test               # Vitest unit tests (design system components)
npm run test:e2e           # Playwright — full sign-in flow, /design smoke, overflow, axe a11y
```

**Verifying the CSP / hydration for real:** always test against a clean production build, never a build directory that's been touched by `next dev` in between. A `.next` directory that mixes dev-mode and production artifacts serves broken assets and spurious CSP violations that look like real bugs but aren't (see the CSP-related entries in `docs/DECISIONS.md` for a worked example — it cost real debugging time once already). The pattern that's actually safe:

```
cd apps/web
rm -rf .next
npm run build
npm run start -- -p 3100
# now test against http://127.0.0.1:3100 — a curl 200 does not prove the page
# hydrates; open it in a real browser (or drive it with Playwright) and check
# the console, not just the HTTP status.
```

`npm run test:e2e` does this correctly on its own (its `webServer` config runs `pretest:e2e` — a full `next build` — before `next start`) — the manual steps above are for when you're debugging a CSP/hydration issue directly and want tighter control over what's running.

### Design tokens

Everything in `tailwind.config.ts` — colors, type scale, spacing, sizing — comes from `OperatorOS-Spec.md` Part B. If you need a size or color that isn't already a token, add it to the config; don't reach for an arbitrary Tailwind value (`text-[#hex]`, `p-[13px]`) — `npm run lint:web` will fail the build if you do (`apps/web/scripts/check-no-arbitrary-tailwind.mjs`).

### Phase 1: the mock backend (no live `apps/api` needed to develop or test the frontend)

Every screen (Onboarding, Counter, Stock Room, Till sessions, Close the Shop, Overview) is genuinely clickable end to end against an in-memory mock — no need to run `apps/api` at all for frontend work.

- `apps/web/lib/api/*.ts` is the typed client — one file per domain (`products.ts`, `sales.ts`, `day.ts`, `till.ts`, `stock.ts`, `customers.ts`, `receipts.ts`, `overview.ts`, `onboarding.ts`), each exporting plain async functions (`listProducts()`, `recordSale()`, `openDay()`, ...) with request/response types in `lib/api/types.ts`.
- `apps/web/lib/mock/` is the mock itself: `seed.ts` has realistic Kigali hardware-store demo data (cement, rebar, paint, tools, plumbing, electrical; RWF pricing), `store.ts` is a mutable in-memory "ledger" that mirrors what the real projections will do (a sale decrements stock and updates the till/customer balance in the same call, day-close computes real variance, etc.) — see `docs/DECISIONS.md` for why this is a hand-rolled adapter rather than MSW.
- `lib/api/config.ts`'s `USE_MOCK_API` constant (`!process.env.NEXT_PUBLIC_API_BASE_URL`) is the *only* place mock-vs-real is decided — every `lib/api/*.ts` function branches there. Set `NEXT_PUBLIC_API_BASE_URL` once `apps/api` is reachable and every function's real branch (wired to the true `apps/api` routes/shapes and validated through the generated Zod client — see "The generated OpenAPI client" below) goes live with no component changes. A handful of frontend capabilities have no real backend counterpart at all (park a sale, list past stock-takes/transfers, MoMo mark-as-cash/void, customer/broadcast features, etc.) — their real branch throws a clear `notSupportedByBackend` error rather than either calling a route that doesn't exist or silently no-opping; see `docs/DECISIONS.md`'s known-gaps entry for the full list.
- The mock resets on every full page reload (a plain module-level `let db` in `store.ts`, deliberately not persisted to localStorage/IndexedDB) — expected, not a bug: each Playwright test navigates fresh and gets a clean slate.
- **First-ever sign-in always goes to Onboarding, not the Shop Floor** (spec D.1) — `lib/api/onboarding.ts` persists progress to `localStorage` (the mock's stand-in for "server-side, resumes on any device") so it survives a reload in the same browser. `e2e/helpers.ts`'s `completeOnboarding()` walks the minimum path (fill Step 1, skip 2–5) for tests that just need to reach the Shop Floor.
- Manager-PIN-gated flows (discount above threshold, credit-limit override) use a hardcoded demo PIN — `DEMO_MANAGER_PIN` in `lib/constants.ts` (currently `9999`) — same spirit as `demo-auth-store.ts`, must be deleted once real role/permission-scoped PIN verification exists.

### The generated OpenAPI client (real-API branch)

`apps/web/lib/api/generated/client.ts` is generated from `apps/api/openapi.json` by `openapi-zod-client` and **committed** — you do NOT need Python or an `apps/api` venv to `npm run typecheck:web`/`test:web`/`build:web`, only to regenerate this file after a backend change. Every `lib/api/*.ts` function's real-API (`USE_MOCK_API === false`) branch validates its response through this file's `schemas.*` (Zod, runtime-validated — the Phase 0 rule this fulfills: frontend validation generated from the backend's OpenAPI spec, never hand-written) while still using the existing hand-written `apiRequest()` (`config.ts`) as the actual transport, so credentials/`Idempotency-Key`/error handling stay in one place.

**Regenerate after any `apps/api` schema/route change:**

```
cd apps/api
.venv/Scripts/python.exe scripts/export_openapi.py     # regenerates apps/api/openapi.json
cd ../../apps/web
npm run generate:api-client                             # regenerates lib/api/generated/client.ts
```

Commit both files together. `npm run check:api-client-fresh` (wired into `npm run lint:web`) fails the build if `apps/api/openapi.json` changed but `lib/api/generated/client.ts` wasn't regenerated to match — the same "keep it honest" gate `no-float-money` is on the backend. Never hand-edit the generated file; it's overwritten wholesale on every regen.

### Phase 1 e2e coverage

```
cd apps/web
npx playwright test e2e/counter.spec.ts   # sell-for-cash+change, credit-limit block+override, barcode-timing, axe on Counter/Stock Room/Overview
```

Runs across all three configured viewports (375/768/1440, `playwright.config.ts`) automatically. `e2e/helpers.ts` has the shared sign-in → onboarding → day-open → Counter path every Phase 1 spec starts from.

**A real, non-obvious gotcha found the hard way:** `skipTillOpen()` (in `helpers.ts`) must actively *wait* for the till-open modal, not just check `.isVisible()` once — that modal only mounts after its data queries resolve (a short but real async gap after the day-open mutation settles), and an instant check can miss it, leaving it open and covering the Counter for the rest of the test. If you add a new helper that dismisses an optional modal, wait for it with a bounded timeout, don't just check-and-move-on.

---

## Backend

Everything below lives in `apps/api` (FastAPI + SQLAlchemy 2.x + Alembic +
Celery). `infra/docker-compose.yml` runs the real stack (Postgres 16,
Redis 7, the API, and the Celery worker); the test suite does **not**
need Docker at all — see "Running the tests" below.

### Prerequisites

- Python 3.12
- Docker + Docker Compose (only needed to run the API/worker locally
  against a real Postgres/Redis — not needed to run the test suite)

### One-time setup

```bash
cd apps/api
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

pip install -e ".[dev]"
```

### Running the stack locally (Docker Compose)

```bash
cd infra
docker compose up -d postgres redis
cd ../apps/api
cp ../../.env.example ../../.env   # then edit if you need non-default values
alembic upgrade head
python scripts/seed.py             # prints a login business_slug/phone/PIN
python -m uvicorn operatoros_api.main:app --reload
```

Or run everything (api + worker included) inside Compose:

```bash
cd infra
docker compose up --build
```

The `worker` service runs Celery with an embedded beat scheduler
(`celery ... worker -B`) — a Phase 0 simplification noted in
`docs/DECISIONS.md`; it's what runs the nightly projection audit
(`operatoros_api.tasks.projection_audit.run_projection_audit`), scheduled
for 02:00 UTC.

### Running migrations

```bash
cd apps/api
alembic upgrade head       # apply
alembic downgrade -1       # roll back one migration
alembic history             # list migrations
```

Migrations run as the `operatoros_admin` role (the docker-compose
bootstrap superuser); the API itself connects as `operatoros_app`, a
non-superuser, non-`BYPASSRLS` role created by
`infra/postgres/init/01-roles.sql` on the container's first boot. If
you've already got a `pgdata` volume from before that role existed, drop
the volume (`docker compose down -v`) and start fresh — the init script
only runs once, on an empty data directory.

### Seeding demo data

```bash
cd apps/api
python scripts/seed.py
```

Creates one demo business (random slug each run — there's no singleton
"the demo tenant" to collide with), a default location, the full set of
default roles/permissions, and one Owner user. Prints the login payload
you need for `POST /api/v1/auth/login` at the end.

### Running the tests

```bash
cd apps/api
python -m pytest
```

**No Docker, no external Postgres/Redis required.** `tests/conftest.py`
spins up a real, throwaway Postgres 16 instance per test session using
the pip-installed `pgserver` package (a genuine Postgres binary shipped
as a Python wheel — not a mock), runs every Alembic migration against it
exactly as production would, and tears it down at the end. Redis-
dependent code (rate limiting, lockout) runs against `fakeredis`, which
implements the same command surface a real Redis does. See
`docs/DECISIONS.md` for why this was chosen over a `services:` block.

The suite includes the cross-tenant isolation suite
(`test_cross_tenant_isolation.py`), which auto-discovers every
authenticated route from the running FastAPI app and attempts to read/
mutate another tenant's data through it — a new endpoint added without
proper tenant scoping fails this automatically; see the file's docstring
for how it decides what to attack.

To run a single file or test:

```bash
python -m pytest tests/test_auth.py -q
python -m pytest tests/test_auth.py::test_lockout_after_max_failed_attempts -q
```

### Linting, formatting, and type-checking

```bash
make lint      # ruff + black --check + mypy + the no-float-money gate, from the repo root
make fmt       # ruff --fix + black, from the repo root
```

or directly:

```bash
cd apps/api
python -m ruff check src tests
python -m black --check src tests
python -m mypy src
python ../../scripts/check_no_float_money.py
```

The no-float-money gate (`scripts/check_no_float_money.py`) fails the
build if a `float` type annotation or literal is attached to a
money-shaped name anywhere in `apps/api` — money is always `int` minor
units (`operatoros_api.money.Minor`). A rare genuine false positive is
silenced with a trailing `# money-lint: ignore` comment on that line.

### Environment variables

See `.env.example` at the repo root — every backend variable is
documented there with a safe local-dev default. Copy it to `.env` (which
is gitignored) and override anything you need for a non-local setup.
`OPERATOROS_ENV=local` is what makes the default `JWT_SECRET` and
`SECRET_ENCRYPTION_KEY` acceptable to use as-is; deployment tooling for
any other environment must inject real values for both.

### Common issues

- **"permission denied for table X"** — you're probably connecting as
  `operatoros_app` and hitting a table your migration hasn't granted it
  access to yet, or RLS is correctly doing its job and there's no
  `app.business_id` GUC set on that connection. Check
  `operatoros_api.db.tenant_scoped_session` is what opened the session.
- **A migration fails with "role operatoros_app does not exist"** — the
  Postgres init script only runs on a fresh data directory. Run
  `docker compose down -v` in `infra/` and start again.
- **Tests are slow the first time** — `pgserver`'s first run per machine
  initializes a fresh Postgres data directory, which takes a few seconds;
  subsequent sessions on the same machine are faster once its binaries
  are cached by pip.
- **Embedded-Postgres temp directories piling up / disk filling over
  time** — `tests/conftest.py`'s `postgres_urls` fixture deletes its own
  temp data directory on teardown (`shutil.rmtree`, added in Phase 1 after
  this exact thing filled a machine's disk to 0 bytes free mid-task). If
  you interrupt a test run hard enough that teardown never runs (killing
  the process, a crash), a `operatoros_pg_*` directory can be left behind
  under your OS temp dir — safe to delete by hand; a fresh one is created
  every session.

### Phase 1 additions

Phase 1 (`docs/plans/phase-1.md`) added the entity tables, projections,
and routers that make the Counter/Stock Room/day-close a real POS on top
of Phase 0's event ledger — no new event types, no new backend setup
steps beyond the ones above. A few things worth knowing when working in
this code:

- **Money locations.** `money_location_balance`'s `account_key` for cash
  is `"till"`, not `"cash"` — a `SALE_RECORDED` payment with
  `method: "cash"` posts to the `till` account (matching spec D.7.1's
  named "TILL" balance, the same account `DAY_OPENED`/`DAY_CLOSED`
  reconciles). Every other payment method (`momo`, `airtel`, `bank`,
  `card`, `cheque`) keeps its own name as its own account. See
  `docs/DECISIONS.md`.
- **A day must be open before a sale can be recorded** — `POST
  /api/v1/day/open` first (`operatoros_api.api.routers.day`). Selling
  without an open day returns 409, not 500; a projection handler
  (`daily_totals.py`) will otherwise raise if it's ever reached with no
  open `DaySession` for the location, since that's a genuine invariant
  violation rather than something to guess a date for.
- **The sale endpoint (`POST /api/v1/sales`) is the most safety-critical
  route in the codebase.** Read `api/routers/sales.py`'s module docstring
  before touching it — it documents the four disclosed simplifications
  (fixed VAT rate, discount/tax ordering, exact-payment-match, no hard
  till-session requirement) and the credit-limit-override flow. Its
  dedicated test suite, `tests/test_sales_atomicity.py`, includes the
  concurrent-double-submit proof (`asyncio.gather`, same shape as Phase
  0's `test_idempotency.py`) — re-run it after any change to this file.
- **Stock-take freeze state is not stored on `product_locations`** — see
  `docs/DECISIONS.md`'s "live query, not a stored flag" entry if you're
  tempted to add a write there; the `reject_direct_projection_write()`
  trigger will reject it (correctly).
- **Product cost/margin fields are visibility-gated** behind the
  `product.view_cost` capability on every read (`ProductOut.cost_price_minor`
  is `None`, never a real `0`, when the caller lacks it) — don't add a
  cost/margin field to a new schema without the same gate.
- **CSV/XLSX product import** (`POST /api/v1/products/import/preview` →
  `/commit`) has no server-side staging — the client re-sends the row set
  `/preview` returned. See `product_import.py`'s module docstring before
  changing the shape of that round trip.
- **Known Phase 1 gaps**, disclosed rather than silently missing:
  binary PDF receipt generation (HTML/text rendering only —
  `api/routers/receipts.py`); the Overview's historical comparison, gross
  profit/expenses, and dead-stock ranking (no Analytics/Cash Box/expense
  data exists until later phases — `api/routers/overview.py`); the
  nightly projection audit does not cover `daily_totals`/
  `staff_daily_totals`/`product_daily_movement` (reporting aggregates,
  not money/inventory integrity — `tasks/projection_audit.py`); stock-take
  scope has no "not counted in 90 days" option yet
  (`api/routers/stock_stocktake.py`); unit conversion factors (e.g. "1 box
  = 12 pieces") are not implemented — products are tracked in one base
  unit only (`models/catalog.py`).
