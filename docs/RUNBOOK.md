# RUNBOOK

Operational how-to for running and working on OperatorOS locally. This
file is meant to let a new engineer get productive without asking anyone.

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
