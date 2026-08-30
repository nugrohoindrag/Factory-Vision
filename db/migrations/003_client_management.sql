-- Factory Vision, internal client management
--
-- Backs the vendor-side admin console: which factories are customers, what
-- they are entitled to, how much they are using it, and who from the vendor
-- reached into their data.
--
-- This sits deliberately outside the tenant-scoped tables. Everything under
-- `tenant_id` belongs to a customer and is fenced by row level security; the
-- tables here belong to the vendor and describe customers from the outside,
-- so they carry no `tenant_id` of their own and RLS does not apply to them.

-- === SUBSCRIPTION PLANS ===

CREATE TABLE IF NOT EXISTS subscription_plan (
  id VARCHAR(64) PRIMARY KEY,
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  -- Nulls mean "no ceiling", which is how an enterprise agreement is written.
  max_plants INT,
  max_production_lines INT,
  max_machines INT,
  max_users INT,
  max_operators INT,
  monthly_price_idr BIGINT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- === CLIENT RECORD ===
--
-- One row per customer, alongside the `tenant` row their data lives under.
-- Kept separate so commercial facts (contract dates, billing contact, account
-- manager) never leak into the MES the customer sees.

CREATE TABLE IF NOT EXISTS client_account (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL UNIQUE REFERENCES tenant(id),
  legal_name VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  industry VARCHAR(128),
  city VARCHAR(128),
  country VARCHAR(64) DEFAULT 'Indonesia',
  contact_name VARCHAR(255),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(64),
  account_manager VARCHAR(255),
  -- PROSPECT and TRIAL exist because a factory is usually evaluating before it
  -- signs, and the console has to show that pipeline honestly.
  lifecycle_status VARCHAR(32) NOT NULL DEFAULT 'TRIAL'
    CHECK (lifecycle_status IN ('PROSPECT', 'TRIAL', 'ACTIVE', 'SUSPENDED', 'CHURNED')),
  deployment_mode VARCHAR(48) NOT NULL DEFAULT 'CLOUD_MULTI_TENANT'
    CHECK (deployment_mode IN ('CLOUD_MULTI_TENANT', 'ON_PREMISE_SINGLE_TENANT')),
  onboarded_at TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_client_account_status ON client_account(lifecycle_status);

-- === SUBSCRIPTION ===
--
-- A client's current entitlement. History is kept by leaving superseded rows
-- in place with `ended_at` set, so a renegotiation can be traced rather than
-- overwriting what the customer was promised last year.

CREATE TABLE IF NOT EXISTS client_subscription (
  id VARCHAR(64) PRIMARY KEY,
  client_id VARCHAR(64) NOT NULL REFERENCES client_account(id) ON DELETE CASCADE,
  plan_id VARCHAR(64) NOT NULL REFERENCES subscription_plan(id),
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'PAST_DUE', 'CANCELLED', 'ENDED')),
  started_at DATE NOT NULL,
  -- The date the agreement lapses. Null means open-ended.
  renews_at DATE,
  ended_at DATE,
  -- Per-client overrides beat the plan's ceilings, because a signed exception
  -- is a fact about this customer, not a new plan for everyone.
  override_max_plants INT,
  override_max_production_lines INT,
  override_max_machines INT,
  override_max_users INT,
  override_max_operators INT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_client_subscription_client ON client_subscription(client_id, status);
CREATE INDEX IF NOT EXISTS idx_client_subscription_renews ON client_subscription(renews_at)
  WHERE status = 'ACTIVE';

-- === USAGE SNAPSHOTS ===
--
-- Usage is sampled rather than computed on demand: a question like "was this
-- plant still recording production last month" cannot be answered from live
-- counters, and a churn conversation needs the trend, not today's number.

CREATE TABLE IF NOT EXISTS client_usage_snapshot (
  id BIGSERIAL PRIMARY KEY,
  client_id VARCHAR(64) NOT NULL REFERENCES client_account(id) ON DELETE CASCADE,
  captured_on DATE NOT NULL,
  plants INT NOT NULL DEFAULT 0,
  production_lines INT NOT NULL DEFAULT 0,
  machines INT NOT NULL DEFAULT 0,
  products INT NOT NULL DEFAULT 0,
  users INT NOT NULL DEFAULT 0,
  operators INT NOT NULL DEFAULT 0,
  active_users_7d INT NOT NULL DEFAULT 0,
  work_orders_created INT NOT NULL DEFAULT 0,
  production_records INT NOT NULL DEFAULT 0,
  downtime_records INT NOT NULL DEFAULT 0,
  terminals_online INT NOT NULL DEFAULT 0,
  last_activity_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (client_id, captured_on)
);

CREATE INDEX IF NOT EXISTS idx_client_usage_client_date
  ON client_usage_snapshot(client_id, captured_on DESC);

-- === SUPPORT ACCESS ===
--
-- Vendor staff sometimes must look inside a customer's console to help. That
-- is a privileged act on someone else's production data, so it is granted for
-- a reason, expires on its own, and is recorded whether or not it gets used.

CREATE TABLE IF NOT EXISTS support_access_grant (
  id VARCHAR(64) PRIMARY KEY,
  client_id VARCHAR(64) NOT NULL REFERENCES client_account(id) ON DELETE CASCADE,
  granted_to VARCHAR(255) NOT NULL,
  granted_by VARCHAR(255) NOT NULL,
  reason TEXT NOT NULL,
  -- Read-only is the default; a write grant has to be asked for explicitly.
  access_level VARCHAR(32) NOT NULL DEFAULT 'READ_ONLY'
    CHECK (access_level IN ('READ_ONLY', 'READ_WRITE')),
  granted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  revoked_at TIMESTAMP WITH TIME ZONE,
  revoked_by VARCHAR(255),
  last_used_at TIMESTAMP WITH TIME ZONE,
  use_count INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_support_grant_client ON support_access_grant(client_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_grant_active ON support_access_grant(expires_at)
  WHERE revoked_at IS NULL;

-- === INTERNAL STAFF ===
--
-- Vendor administrators, distinct from `app_user`, which is a customer's own
-- staff. Keeping them in separate tables means a customer admin can never be
-- escalated into a vendor admin by editing a role.

CREATE TABLE IF NOT EXISTS internal_user (
  id VARCHAR(64) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'SUPPORT'
    CHECK (role IN ('OWNER', 'ACCOUNT_MANAGER', 'SUPPORT')),
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  password_hash TEXT,
  last_login_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Every vendor-side action, kept apart from the tenant audit log so a
-- customer's audit trail is never mixed with the vendor's own.
CREATE TABLE IF NOT EXISTS internal_audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_email VARCHAR(255) NOT NULL,
  action VARCHAR(64) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(64),
  client_id VARCHAR(64) REFERENCES client_account(id) ON DELETE SET NULL,
  previous_value JSONB,
  new_value JSONB,
  ip VARCHAR(64),
  occurred_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_internal_audit_time ON internal_audit_log(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_internal_audit_client ON internal_audit_log(client_id, occurred_at DESC);

-- === BASELINE PLANS ===
--
-- Three tiers matching how the product is sold to mid-market Indonesian
-- manufacturing: one line to start, a full plant, then multi-plant groups.

INSERT INTO subscription_plan (id, code, name, description, max_plants, max_production_lines, max_machines, max_users, max_operators, monthly_price_idr)
VALUES
  ('plan-starter', 'STARTER', 'Starter',
   'Satu plant, satu production line. Untuk pabrik yang baru memulai digitalisasi.',
   1, 1, 10, 10, 25, 4500000),
  ('plan-plant', 'PLANT', 'Plant',
   'Satu plant dengan beberapa production line dan analitik OEE penuh.',
   1, 10, 80, 50, 200, 12500000),
  ('plan-enterprise', 'ENTERPRISE', 'Enterprise',
   'Multi-plant tanpa batas unit, termasuk deployment on-premise.',
   NULL, NULL, NULL, NULL, NULL, 35000000)
ON CONFLICT (code) DO NOTHING;
