-- Operators sign in with an email and a password, like every other account.
--
-- The shop-floor terminal used to take an employee number and a numeric PIN
-- (US-002). A keypad credential drawn from ten digits was the weakest door in
-- the product and needed its own lockout, its own policy and its own bootstrap
-- variable. The operator now carries an email and a password hash on the same
-- row the terminal already reads, hashed exactly as app_user.password_hash is.
--
-- The `operator` record stays the shop-floor identity that production records
-- point at; only the credential changes. pin_hash and operator_credential go
-- with the PIN: a column nothing reads is a column that will be written to by
-- mistake. Idempotent: `fv migrate` replays the directory on every deploy.

ALTER TABLE operator ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE operator ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

-- One email per operator within a tenant, case-insensitively, so a login
-- lookup by email is unambiguous. Operators without an email cannot sign in
-- and are left out of the index.
CREATE UNIQUE INDEX IF NOT EXISTS uq_operator_tenant_email
  ON operator (tenant_id, lower(email)) WHERE email IS NOT NULL;

ALTER TABLE operator DROP COLUMN IF EXISTS pin_hash;
DROP TABLE IF EXISTS operator_credential;
