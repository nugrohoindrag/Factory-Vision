-- Durable sessions (Cyber Security Requirement §6).
--
-- Sessions lived in a `Map` inside the API process. Three things followed from
-- that, and all three are security properties the requirement asks for:
--
--   * a deployment logged everybody out, so "session timeout" was really
--     "until the next release";
--   * an administrator revoking a session, or suspending an account, lost that
--     decision at the next restart — the control that matters most on the day
--     somebody leaves;
--   * a second API replica could not be run at all, because each would hold
--     its own half of the sessions.
--
-- The token itself is never stored. What is stored is its SHA-256, so a
-- database dump — the copy most likely to leave the building — cannot be
-- replayed as a live session.

CREATE TABLE IF NOT EXISTS app_session (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  kind VARCHAR(16) NOT NULL,
  subject_id VARCHAR(64) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  -- The resolved principal: role, permissions and scope are re-derived on
  -- read, so this is a snapshot for listing and forensics, not the authority.
  principal JSONB NOT NULL,
  issued_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  idle_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip VARCHAR(64),
  user_agent TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_session_token ON app_session (token_hash);
CREATE INDEX IF NOT EXISTS idx_app_session_subject ON app_session (tenant_id, subject_id);
CREATE INDEX IF NOT EXISTS idx_app_session_expiry ON app_session (expires_at);

ALTER TABLE app_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_session FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'app_session' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON app_session
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- Housekeeping crosses tenants, so it needs a policy of its own. It permits
-- exactly one thing — deleting a session that is already dead — and grants no
-- read, so it cannot become a way to see another tenant's sessions.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'app_session' AND policyname = 'expired_cleanup'
  ) THEN
    CREATE POLICY expired_cleanup ON app_session FOR DELETE
      USING (expires_at <= now() OR idle_expires_at <= now());
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factory_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON app_session TO factory_app;
  END IF;
END $$;
