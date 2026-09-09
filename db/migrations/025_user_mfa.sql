-- Multi-factor authentication for application users (Cyber Security
-- Requirement §5, §56).
--
-- One row per enrolled account. The TOTP secret is stored encrypted, not in
-- the clear: unlike a password it has to be recoverable to be verified, so the
-- protection has to come from a key that lives outside the database. A dump
-- without MFA_ENCRYPTION_KEY yields nothing that can generate codes.
--
-- Recovery codes are credentials in their own right and are stored the way
-- credentials are: hashed, single use, consumed by deletion from the array.

CREATE TABLE IF NOT EXISTS user_mfa (
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  user_id VARCHAR(64) NOT NULL,
  -- AES-256-GCM, formatted `v1:<iv>:<tag>:<ciphertext>`; see secret-box.ts.
  secret_encrypted TEXT NOT NULL,
  -- Enrolment is two steps: a secret is issued, then proven with a code. Only
  -- a confirmed row is enforced at login, so a half-finished enrolment can
  -- never lock somebody out of their own account.
  confirmed_at TIMESTAMP WITH TIME ZONE,
  recovery_code_hashes TEXT[] NOT NULL DEFAULT '{}',
  last_used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_mfa_user ON user_mfa (tenant_id, user_id);

ALTER TABLE user_mfa ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_mfa FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_mfa' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON user_mfa
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factory_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON user_mfa TO factory_app;
  END IF;
END $$;
