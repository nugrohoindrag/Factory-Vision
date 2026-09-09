-- ============================================================================
-- 030  MES Improvement v2.0 — Workforce & Labor Management (PRD §6, §19)
-- ============================================================================
--
-- v1.7 knew an operator's name, employee number and line. That is enough to
-- log in and not much else: it cannot answer "may this person run this
-- machine", which is the question a supervisor is actually asking when they
-- assign work (BR-W01).
--
-- Skill is the unit. An operator holds skills at levels with expiry dates; a
-- machine or a process demands skills at minimum levels. Eligibility is those
-- two sets compared, plus availability — never a flag on the operator row,
-- because a flag cannot say *why* somebody is not eligible.

CREATE TABLE IF NOT EXISTS skill (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  code VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(64),
  description TEXT,
  max_level INT NOT NULL DEFAULT 3,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_skill_code UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS operator_qualification (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  operator_id VARCHAR(64) NOT NULL REFERENCES operator(id) ON DELETE CASCADE,
  skill_id VARCHAR(64) NOT NULL REFERENCES skill(id) ON DELETE CASCADE,
  level INT NOT NULL DEFAULT 1,
  certified_date DATE NOT NULL DEFAULT CURRENT_DATE,
  -- NULL means "does not expire". A date in the past makes the qualification
  -- EXPIRED on read (BR-W02); the row is never rewritten to say so, because
  -- expiry is a fact about time rather than an event anybody triggers.
  expiry_date DATE,
  issuer VARCHAR(255),
  certificate_number VARCHAR(128),
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  suspended_reason TEXT,
  created_by VARCHAR(64),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_operator_skill UNIQUE (tenant_id, operator_id, skill_id)
);

-- §6.2, §6.3 — what a machine or a process demands of whoever runs it.
CREATE TABLE IF NOT EXISTS qualification_requirement (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  target_type VARCHAR(16) NOT NULL,
  target_id VARCHAR(64) NOT NULL,
  skill_id VARCHAR(64) NOT NULL REFERENCES skill(id) ON DELETE CASCADE,
  minimum_level INT NOT NULL DEFAULT 1,
  mandatory BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_qualification_requirement UNIQUE (tenant_id, target_type, target_id, skill_id)
);

CREATE TABLE IF NOT EXISTS operator_shift_assignment (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  operator_id VARCHAR(64) NOT NULL REFERENCES operator(id) ON DELETE CASCADE,
  shift_id VARCHAR(64) NOT NULL REFERENCES shift(id) ON DELETE CASCADE,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_by VARCHAR(64),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- §6.5 — availability is a history, not a column on `operator`.
--
-- "Is Budi available" and "was Budi available last Tuesday" are the same
-- question asked at two moments, and a single mutable flag can only answer the
-- first. The current state is the row whose window contains now.
CREATE TABLE IF NOT EXISTS operator_availability (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  operator_id VARCHAR(64) NOT NULL REFERENCES operator(id) ON DELETE CASCADE,
  state VARCHAR(32) NOT NULL DEFAULT 'AVAILABLE',
  shift_id VARCHAR(64) REFERENCES shift(id),
  effective_from TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  effective_to TIMESTAMP WITH TIME ZONE,
  reason TEXT,
  updated_by VARCHAR(64),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS labor_requirement (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  work_order_id VARCHAR(64) NOT NULL REFERENCES work_order(id) ON DELETE CASCADE,
  process_id VARCHAR(64) REFERENCES production_process(id),
  machine_id VARCHAR(64) REFERENCES machine(id),
  required_operators INT NOT NULL DEFAULT 1,
  shift_id VARCHAR(64) REFERENCES shift(id),
  notes TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_labor_requirement_wo UNIQUE (tenant_id, work_order_id)
);

CREATE TABLE IF NOT EXISTS labor_assignment (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  work_order_id VARCHAR(64) NOT NULL REFERENCES work_order(id) ON DELETE CASCADE,
  operator_id VARCHAR(64) NOT NULL REFERENCES operator(id),
  role VARCHAR(64),
  shift_id VARCHAR(64) REFERENCES shift(id),
  assigned_by VARCHAR(64) NOT NULL,
  assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  unassigned_at TIMESTAMP WITH TIME ZONE,
  status VARCHAR(32) NOT NULL DEFAULT 'ASSIGNED',
  -- What the assignment was validated against, kept because §39 audits
  -- operator assignment and "they were qualified at the time" is the claim.
  qualification_check JSONB
);

CREATE TABLE IF NOT EXISTS labor_time_record (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  operator_id VARCHAR(64) NOT NULL REFERENCES operator(id),
  work_order_id VARCHAR(64) REFERENCES work_order(id),
  shift_id VARCHAR(64) REFERENCES shift(id),
  shift_date DATE NOT NULL,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL,
  ended_at TIMESTAMP WITH TIME ZONE,
  productive_minutes NUMERIC(10, 2) NOT NULL DEFAULT 0,
  available_minutes NUMERIC(10, 2) NOT NULL DEFAULT 0,
  category VARCHAR(32) NOT NULL DEFAULT 'PRODUCTIVE',
  recorded_by VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS idx_operator_qualification_operator ON operator_qualification (tenant_id, operator_id);
CREATE INDEX IF NOT EXISTS idx_operator_qualification_expiry ON operator_qualification (tenant_id, expiry_date);
CREATE INDEX IF NOT EXISTS idx_qualification_requirement_target ON qualification_requirement (tenant_id, target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_operator_shift_assignment ON operator_shift_assignment (tenant_id, operator_id, effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_operator_availability_current ON operator_availability (tenant_id, operator_id, effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_labor_assignment_wo ON labor_assignment (tenant_id, work_order_id, status);
CREATE INDEX IF NOT EXISTS idx_labor_assignment_operator ON labor_assignment (tenant_id, operator_id, status);
CREATE INDEX IF NOT EXISTS idx_labor_time_operator ON labor_time_record (tenant_id, operator_id, shift_date);

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'skill', 'operator_qualification', 'qualification_requirement', 'operator_shift_assignment',
    'operator_availability', 'labor_requirement', 'labor_assignment', 'labor_time_record'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'tenant_isolation') THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true))'
        || ' WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
        t
      );
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factory_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO factory_app', t);
    END IF;
  END LOOP;
END $$;
