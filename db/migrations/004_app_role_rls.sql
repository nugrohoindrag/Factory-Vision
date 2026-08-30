-- ============================================================================
-- 004  Application role that RLS actually applies to
-- ============================================================================
--
-- Migrations 001 and 002 enable FORCE ROW LEVEL SECURITY and add a
-- `tenant_isolation` policy keyed on `current_setting('app.tenant_id', true)`
-- to every tenant-scoped table. That machinery was inert in practice: the role
-- in `deploy/docker-compose.yml` is the one `postgres:16-alpine` creates from
-- POSTGRES_USER, which is a SUPERUSER and therefore carries BYPASSRLS. A
-- superuser is exempt from every policy, so tenant B could read tenant A's
-- production records and a connection that declared no tenant at all saw the
-- whole table.
--
-- Postgres has no way to make a policy apply to a superuser, so the fix is a
-- second role: the schema stays owned by the bootstrap superuser (it has to
-- create tables and run migrations), while the API connects as `factory_app`,
-- which is NOSUPERUSER NOBYPASSRLS and thus subject to the policies.
--
-- No password lives here. The role is created NOLOGIN and stays unusable until
-- an operator gives it one, which `db/migrate.ts` does from APP_DB_PASSWORD so
-- the secret comes from the environment and never from a committed file.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factory_app') THEN
    CREATE ROLE factory_app NOLOGIN;
  END IF;
END
$$;

-- Asserted on every run, not just at creation: these are the attributes that
-- make the tenant policies binding, and a role that drifted back to BYPASSRLS
-- would silently reopen the hole this migration exists to close.
ALTER ROLE factory_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;

GRANT USAGE ON SCHEMA public TO factory_app;

-- DML only. The application never issues DDL; schema changes arrive through
-- migrations run by the owner, so the app role has no business holding CREATE.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO factory_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO factory_app;

-- Tables added by a later migration must be reachable without re-granting by
-- hand, otherwise the next schema change breaks the application at runtime.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO factory_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO factory_app;
