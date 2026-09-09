-- ============================================================================
-- 029  MES Improvement v2.0 — Maintenance Management (PRD §5, §17)
-- ============================================================================
--
-- Three kinds of maintenance, one record (§5.1). Preventive comes from a plan
-- and a meter, corrective from a request, emergency from a breakdown that is
-- already costing production — but all three end up as the same row, because
-- MTBF and MTTR are computed across the lot and a schema that split them would
-- make that a union query nobody maintains.
--
-- `downtime_id` is the link BR-MT03 requires: emergency maintenance is
-- downtime, and the two records have to point at each other or the OEE figure
-- and the maintenance report will disagree about the same hour.

CREATE TABLE IF NOT EXISTS maintenance_plan (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  plan_number VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  machine_id VARCHAR(64) NOT NULL REFERENCES machine(id),
  trigger_type VARCHAR(32) NOT NULL DEFAULT 'CALENDAR',
  interval_value NUMERIC(12, 2) NOT NULL,
  interval_unit VARCHAR(32) NOT NULL DEFAULT 'DAY',
  tasks JSONB NOT NULL DEFAULT '[]'::jsonb,
  estimated_duration_minutes INT,
  last_performed_at TIMESTAMP WITH TIME ZONE,
  last_performed_meter NUMERIC(16, 2),
  next_due_at TIMESTAMP WITH TIME ZONE,
  next_due_meter NUMERIC(16, 2),
  warning_threshold NUMERIC(12, 2),
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  created_by VARCHAR(64),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_maintenance_plan_number UNIQUE (tenant_id, plan_number)
);

CREATE TABLE IF NOT EXISTS maintenance_request (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  request_number VARCHAR(64) NOT NULL,
  machine_id VARCHAR(64) NOT NULL REFERENCES machine(id),
  maintenance_type VARCHAR(32) NOT NULL DEFAULT 'CORRECTIVE',
  priority VARCHAR(16) NOT NULL DEFAULT 'MEDIUM',
  problem_description TEXT NOT NULL,
  reported_symptom TEXT,
  work_order_id VARCHAR(64) REFERENCES work_order(id),
  downtime_id VARCHAR(64),
  requested_by VARCHAR(64) NOT NULL,
  requested_by_name VARCHAR(255),
  requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(32) NOT NULL DEFAULT 'REQUESTED',
  maintenance_record_id VARCHAR(64),
  notes TEXT,
  CONSTRAINT uq_maintenance_request_number UNIQUE (tenant_id, request_number)
);

CREATE TABLE IF NOT EXISTS maintenance_record (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  maintenance_number VARCHAR(64) NOT NULL,
  machine_id VARCHAR(64) NOT NULL REFERENCES machine(id),
  maintenance_type VARCHAR(32) NOT NULL,
  maintenance_plan_id VARCHAR(64) REFERENCES maintenance_plan(id),
  maintenance_request_id VARCHAR(64) REFERENCES maintenance_request(id),
  downtime_id VARCHAR(64),
  status VARCHAR(32) NOT NULL DEFAULT 'PLANNED',
  problem TEXT,
  root_cause TEXT,
  action_taken TEXT,
  requester_id VARCHAR(64),
  requester_name VARCHAR(255),
  technician_id VARCHAR(64),
  technician_name VARCHAR(255),
  scheduled_for TIMESTAMP WITH TIME ZONE,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  duration_minutes INT,
  result VARCHAR(32),
  cost_reference NUMERIC(16, 2),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_maintenance_number UNIQUE (tenant_id, maintenance_number)
);

CREATE TABLE IF NOT EXISTS maintenance_part_usage (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  maintenance_record_id VARCHAR(64) NOT NULL REFERENCES maintenance_record(id) ON DELETE CASCADE,
  part_id VARCHAR(64),
  part_name VARCHAR(255) NOT NULL,
  quantity NUMERIC(12, 4) NOT NULL DEFAULT 1,
  uom VARCHAR(32) NOT NULL DEFAULT 'PCS',
  cost_reference NUMERIC(16, 2)
);

CREATE INDEX IF NOT EXISTS idx_maintenance_plan_machine ON maintenance_plan (tenant_id, machine_id, status);
CREATE INDEX IF NOT EXISTS idx_maintenance_plan_due ON maintenance_plan (tenant_id, next_due_at);
CREATE INDEX IF NOT EXISTS idx_maintenance_request_status ON maintenance_request (tenant_id, status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_maintenance_record_machine ON maintenance_record (tenant_id, machine_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_maintenance_record_status ON maintenance_record (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_maintenance_part_record ON maintenance_part_usage (maintenance_record_id);

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'maintenance_plan', 'maintenance_request', 'maintenance_record', 'maintenance_part_usage'
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

-- ---------------------------------------------------------------------------
-- A downtime reason for emergency maintenance.
--
-- BR-MT03 makes emergency maintenance produce downtime, and `downtime_record`
-- requires a reason from the master (US-016) — an emergency that could not be
-- recorded because nobody had configured a code would be the one hour the
-- Pareto is missing. Created per tenant, once, and only if absent.
-- ---------------------------------------------------------------------------
INSERT INTO downtime_reason (id, tenant_id, category, code, name, description, is_planned, active, sort_order)
SELECT
  'dtr-' || t.id || '-emergency-maint',
  t.id,
  'MACHINE',
  'MT-EMG',
  'Emergency Maintenance',
  'Kerusakan mesin yang memerlukan perbaikan segera (Improvement PRD §5.4).',
  FALSE,
  TRUE,
  90
FROM tenant t
WHERE NOT EXISTS (
  SELECT 1 FROM downtime_reason r WHERE r.tenant_id = t.id AND r.code = 'MT-EMG'
);

INSERT INTO downtime_reason (id, tenant_id, category, code, name, description, is_planned, active, sort_order)
SELECT
  'dtr-' || t.id || '-planned-maint',
  t.id,
  'MACHINE',
  'MT-PM',
  'Preventive Maintenance',
  'Perawatan terjadwal sesuai maintenance plan (Improvement PRD §5.2).',
  TRUE,
  TRUE,
  91
FROM tenant t
WHERE NOT EXISTS (
  SELECT 1 FROM downtime_reason r WHERE r.tenant_id = t.id AND r.code = 'MT-PM'
);
