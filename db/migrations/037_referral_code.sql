-- Referral codes gate the public trial form.
--
-- The trial form is reachable by anyone on the internet, and a workspace is
-- expensive: a tenant, a client account, a subscription, an administrator.
-- A referral code is issued by the vendor's own staff to a person they have
-- actually talked to, so a registration without one is refused at the door.
-- Codes are vendor records, like support_access_grant: no tenant, no RLS.
--
-- A code carries how many registrations it may admit and when it stops
-- working. A revoked code stays in the table, because the audit question
-- "which code let this factory in?" has to keep its answer.

CREATE TABLE IF NOT EXISTS referral_code (
  id VARCHAR(64) PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  -- Who or what the code was issued for: a prospect, an event, a partner.
  label VARCHAR(255) NOT NULL,
  created_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- NULL never expires.
  expires_at TIMESTAMP WITH TIME ZONE,
  max_uses INT NOT NULL DEFAULT 1 CHECK (max_uses >= 1),
  use_count INT NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  last_used_at TIMESTAMP WITH TIME ZONE,
  revoked_at TIMESTAMP WITH TIME ZONE,
  revoked_by VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_referral_code_created ON referral_code (created_at DESC);

-- The code that admitted a client, kept on the account so the portfolio can
-- answer it without a join through the trial form's history.
ALTER TABLE client_account ADD COLUMN IF NOT EXISTS referral_code VARCHAR(32);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factory_app') THEN
    GRANT SELECT, INSERT, UPDATE ON referral_code TO factory_app;
  END IF;
END $$;
