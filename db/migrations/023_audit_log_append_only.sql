-- Audit trail immutability (Cyber Security Requirement §16).
--
-- The application layer already treats `audit_log` as append-only: nothing in
-- the repository issues an UPDATE or a DELETE, and a correction is written as
-- a new row. That is a convention, and a convention is not a control — the
-- application role still held UPDATE and DELETE on every table in the schema,
-- so anything able to run a query as the application could rewrite the record
-- of what it had just done.
--
-- Privileges are the control. The application may read the trail and append to
-- it, and nothing more. Retention and archival are owner operations, performed
-- under the documented procedure rather than by the running service.
--
-- Idempotent by construction: REVOKE and GRANT are declarations of the end
-- state, so the deployment runner replaying this file changes nothing. It must
-- also sort after 004, which re-grants the full DML set on every run.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factory_app') THEN
    RAISE NOTICE 'factory_app role absent, skipping audit privilege hardening';
    RETURN;
  END IF;

  -- Customer-facing audit trail.
  REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM factory_app;
  GRANT SELECT, INSERT ON audit_log TO factory_app;

  -- The vendor's own trail of cross-customer actions, which is the one a
  -- customer would ask to see when they want to know who at the vendor
  -- touched their data.
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'internal_audit_log') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON internal_audit_log FROM factory_app;
    GRANT SELECT, INSERT ON internal_audit_log TO factory_app;
  END IF;
END
$$;
