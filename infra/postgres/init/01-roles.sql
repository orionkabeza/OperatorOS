-- Runs once, automatically, on first container init (docker-entrypoint-initdb.d),
-- connected as the bootstrap superuser (POSTGRES_USER, i.e. operatoros_admin --
-- see infra/docker-compose.yml). Alembic migrations run as that same
-- bootstrap role and GRANT specific per-table privileges to operatoros_app
-- once the tables exist (apps/api/alembic/versions/0001_tenancy_and_rls.py
-- onward). This script only needs to create the role itself.
--
-- operatoros_app is the role the API and worker processes actually connect
-- as: NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE. RLS's guarantee
-- ("a forgotten WHERE clause cannot leak data across tenants") only holds
-- because this role has none of the privileges that let Postgres skip a
-- row-security policy.
--
-- The password below is a fixed, publicly-visible, LOCAL-DEV-ONLY value.
-- It only ever protects a connection between containers on the compose
-- network. Never reuse it, or this pattern of a hardcoded password in an
-- init script, outside local development -- see docs/RUNBOOK.md.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'operatoros_app') THEN
        CREATE ROLE operatoros_app
            LOGIN
            PASSWORD 'operatoros_app_dev_only'
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            NOBYPASSRLS;
    END IF;
END
$$;

GRANT CONNECT ON DATABASE operatoros TO operatoros_app;
GRANT USAGE ON SCHEMA public TO operatoros_app;
