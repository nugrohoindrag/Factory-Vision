-- State the Node API kept only in process memory, given tables by the Go
-- backend (apps/api-go, milestone M6).
--
-- Onboarding progress and the welcome-tour guidance lived in two `Map`s
-- inside OnboardingService, so a deployment reset every trial to "not
-- started" and a second replica disagreed with the first about which steps
-- were done. The vendor console's sessions lived in a third map, with the
-- same two consequences. Each becomes a row here; the shape follows the
-- domain types the console already reads, so nothing on the client changes.
--
-- Idempotent throughout: the image's migrator replays every file on every
-- deploy (see apps/api/src/migrate.ts).

-- --- Onboarding progress (per tenant) ------------------------------------

CREATE TABLE IF NOT EXISTS onboarding_progress (
  tenant_id VARCHAR(64) PRIMARY KEY REFERENCES tenant(id),
  user_id VARCHAR(64) NOT NULL,
  trial_status VARCHAR(16) NOT NULL DEFAULT 'active',
  trial_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  trial_end TIMESTAMP WITH TIME ZONE NOT NULL,
  experience_type VARCHAR(16),
  template_applied VARCHAR(64),
  -- FactoryProfileInput and Record<OnboardingStepId, OnboardingStepState>,
  -- as the console consumes them.
  factory_profile JSONB,
  steps JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE onboarding_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_progress FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'onboarding_progress' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON onboarding_progress
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- --- Welcome tour and tooltip guidance (per tenant) ------------------------

CREATE TABLE IF NOT EXISTS onboarding_guidance (
  tenant_id VARCHAR(64) PRIMARY KEY REFERENCES tenant(id),
  tour_completed BOOLEAN NOT NULL DEFAULT FALSE,
  tour_skipped BOOLEAN NOT NULL DEFAULT FALSE,
  dismissed_tooltips JSONB NOT NULL DEFAULT '[]'::jsonb,
  active_tour_step INT,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE onboarding_guidance ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_guidance FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'onboarding_guidance' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON onboarding_guidance
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- --- Onboarding funnel events (append-only) -------------------------------
--
-- The Node API kept the last 500 in a ring buffer nobody could read back.
-- Persisted, the funnel (signup → template → first order → conversion) can
-- be reported on; append-only by privilege like the other event tables.

CREATE TABLE IF NOT EXISTS onboarding_analytics_event (
  id BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  event_name VARCHAR(64) NOT NULL,
  user_id VARCHAR(64),
  occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_onboarding_event_tenant ON onboarding_analytics_event (tenant_id, occurred_at);

ALTER TABLE onboarding_analytics_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_analytics_event FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'onboarding_analytics_event' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON onboarding_analytics_event
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- --- Vendor console sessions ------------------------------------------------
--
-- No tenant: the vendor's staff are not a tenant. The token is stored as its
-- SHA-256, like app_session, so a dump cannot be replayed.

CREATE TABLE IF NOT EXISTS internal_session (
  id VARCHAR(64) PRIMARY KEY,
  token_hash CHAR(64) NOT NULL,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL,
  issued_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  idle_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  ip VARCHAR(64)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_internal_session_token ON internal_session (token_hash);
CREATE INDEX IF NOT EXISTS idx_internal_session_expiry ON internal_session (expires_at);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factory_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON onboarding_progress TO factory_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON onboarding_guidance TO factory_app;
    -- Append-only by privilege, like audit_log: the default privileges from
    -- migration 004 granted UPDATE and DELETE, which are taken back here.
    REVOKE UPDATE, DELETE, TRUNCATE ON onboarding_analytics_event FROM factory_app;
    GRANT SELECT, INSERT ON onboarding_analytics_event TO factory_app;
    GRANT USAGE, SELECT ON SEQUENCE onboarding_analytics_event_id_seq TO factory_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON internal_session TO factory_app;
  END IF;
END $$;
