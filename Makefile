# OperatorOS — root Makefile
#
# Backend (apps/api) targets only for now -- see docs/RUNBOOK.md "## Backend"
# for the full local setup (Docker Compose, or the embedded-Postgres test
# path that needs no external services at all). Frontend targets land
# alongside these from the parallel design-system work on this branch;
# compose them (e.g. `test: test-api test-web`) at merge time rather than
# renaming what's here.
#
# Every target assumes the correct Python environment is already active
# (apps/api/.venv, or whatever CI's setup step activates) -- this Makefile
# does not itself manage virtualenvs.

.PHONY: migrate seed test lint fmt

migrate: ## Run Alembic migrations (spec E.2/E.4 schema + RLS policies).
	cd apps/api && alembic upgrade head

seed: ## Seed one local demo business, an Owner user, and default roles.
	cd apps/api && python scripts/seed.py

test: ## Run the backend test suite. Spins up its own embedded Postgres 16 (pgserver) per session -- no docker-compose/external services required.
	cd apps/api && python -m pytest

lint: ## ruff + black --check + mypy + the no-float-money gate (spec E.5).
	cd apps/api && python -m ruff check src tests
	cd apps/api && python -m black --check src tests
	cd apps/api && python -m mypy src
	python scripts/check_no_float_money.py

fmt: ## Apply ruff --fix and black formatting.
	cd apps/api && python -m ruff check --fix src tests
	cd apps/api && python -m black src tests
