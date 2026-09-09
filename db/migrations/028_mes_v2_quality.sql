-- ============================================================================
-- 028  MES Improvement v2.0 — Quality Execution Lifecycle (PRD §4, §16)
-- ============================================================================
--
-- v1.7 recorded quality as a reject count. That answers "how many were bad"
-- and nothing else: not what was measured, not who decided what happened to
-- the failed quantity, and not whether the good quantity was ever released.
--
-- The lifecycle here is inspection → result → hold → disposition → NCR →
-- corrective action. Each step is its own table because each is a decision
-- with its own owner and its own timestamp (§39 audits all of them), and
-- collapsing them would mean a disposition could not be traced to the
-- inspection that forced it.

CREATE TABLE IF NOT EXISTS inspection_plan (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  plan_number VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  inspection_type VARCHAR(32) NOT NULL DEFAULT 'IN_PROCESS',
  product_id VARCHAR(64) REFERENCES product(id),
  process_id VARCHAR(64) REFERENCES production_process(id),
  sampling_method VARCHAR(32) NOT NULL DEFAULT 'FIXED_QUANTITY',
  sampling_quantity NUMERIC(12, 4),
  frequency VARCHAR(128),
  -- BR-Q02: a mandatory plan that has not passed blocks the downstream handoff.
  mandatory BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  created_by VARCHAR(64),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_inspection_plan_number UNIQUE (tenant_id, plan_number)
);

CREATE TABLE IF NOT EXISTS inspection_characteristic (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  inspection_plan_id VARCHAR(64) NOT NULL REFERENCES inspection_plan(id) ON DELETE CASCADE,
  sequence INT NOT NULL DEFAULT 1,
  name VARCHAR(255) NOT NULL,
  data_type VARCHAR(16) NOT NULL DEFAULT 'NUMERIC',
  specification VARCHAR(255),
  lower_limit NUMERIC(16, 4),
  upper_limit NUMERIC(16, 4),
  target_value NUMERIC(16, 4),
  uom VARCHAR(32),
  required BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS inspection (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  inspection_number VARCHAR(64) NOT NULL,
  inspection_plan_id VARCHAR(64) REFERENCES inspection_plan(id),
  inspection_type VARCHAR(32) NOT NULL DEFAULT 'IN_PROCESS',
  work_order_id VARCHAR(64) REFERENCES work_order(id),
  batch_id VARCHAR(64) REFERENCES production_batch(id),
  product_id VARCHAR(64) REFERENCES product(id),
  process_id VARCHAR(64) REFERENCES production_process(id),
  machine_id VARCHAR(64) REFERENCES machine(id),
  inspected_quantity NUMERIC(16, 4) NOT NULL DEFAULT 0,
  passed_quantity NUMERIC(16, 4) NOT NULL DEFAULT 0,
  failed_quantity NUMERIC(16, 4) NOT NULL DEFAULT 0,
  uom VARCHAR(32),
  result VARCHAR(16) NOT NULL DEFAULT 'PASS',
  operator_id VARCHAR(64) REFERENCES operator(id),
  inspector_id VARCHAR(64) NOT NULL,
  inspector_name VARCHAR(255),
  inspected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  disposition_id VARCHAR(64),
  idempotency_key VARCHAR(128),
  notes TEXT,
  CONSTRAINT uq_inspection_number UNIQUE (tenant_id, inspection_number),
  CONSTRAINT uq_inspection_idem UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS inspection_result_line (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  inspection_id VARCHAR(64) NOT NULL REFERENCES inspection(id) ON DELETE CASCADE,
  characteristic_id VARCHAR(64),
  characteristic_name VARCHAR(255) NOT NULL,
  expected_value VARCHAR(255),
  actual_value VARCHAR(255),
  numeric_value NUMERIC(16, 4),
  result VARCHAR(16) NOT NULL DEFAULT 'PASS',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS quality_hold (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  hold_number VARCHAR(64) NOT NULL,
  work_order_id VARCHAR(64) REFERENCES work_order(id),
  batch_id VARCHAR(64) REFERENCES production_batch(id),
  product_id VARCHAR(64) REFERENCES product(id),
  material_id VARCHAR(64) REFERENCES product(id),
  inspection_id VARCHAR(64) REFERENCES inspection(id),
  quantity NUMERIC(16, 4) NOT NULL DEFAULT 0,
  uom VARCHAR(32),
  -- BR-Q04: a hold without an owner and a reason is a quantity nobody will
  -- ever decide about, so both columns are NOT NULL.
  reason TEXT NOT NULL,
  owner_id VARCHAR(64) NOT NULL,
  owner_name VARCHAR(255),
  status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
  held_by VARCHAR(64) NOT NULL,
  held_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_by VARCHAR(64),
  released_at TIMESTAMP WITH TIME ZONE,
  disposition_id VARCHAR(64),
  notes TEXT,
  CONSTRAINT uq_quality_hold_number UNIQUE (tenant_id, hold_number)
);

CREATE TABLE IF NOT EXISTS quality_disposition (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  inspection_id VARCHAR(64) REFERENCES inspection(id),
  quality_hold_id VARCHAR(64) REFERENCES quality_hold(id),
  work_order_id VARCHAR(64) REFERENCES work_order(id),
  batch_id VARCHAR(64) REFERENCES production_batch(id),
  product_id VARCHAR(64) REFERENCES product(id),
  decision VARCHAR(32) NOT NULL,
  quantity NUMERIC(16, 4) NOT NULL DEFAULT 0,
  uom VARCHAR(32),
  reason TEXT NOT NULL,
  defect_code VARCHAR(64),
  ncr_id VARCHAR(64),
  decided_by VARCHAR(64) NOT NULL,
  decided_by_name VARCHAR(255),
  decided_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS non_conformance_record (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  ncr_number VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  severity VARCHAR(16) NOT NULL DEFAULT 'MEDIUM',
  status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
  product_id VARCHAR(64) REFERENCES product(id),
  batch_id VARCHAR(64) REFERENCES production_batch(id),
  work_order_id VARCHAR(64) REFERENCES work_order(id),
  process_id VARCHAR(64) REFERENCES production_process(id),
  machine_id VARCHAR(64) REFERENCES machine(id),
  operator_id VARCHAR(64) REFERENCES operator(id),
  defect_code VARCHAR(64),
  inspection_id VARCHAR(64) REFERENCES inspection(id),
  quantity NUMERIC(16, 4),
  uom VARCHAR(32),
  root_cause TEXT,
  owner_id VARCHAR(64) NOT NULL,
  owner_name VARCHAR(255),
  raised_by VARCHAR(64) NOT NULL,
  raised_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  due_date DATE,
  closed_by VARCHAR(64),
  closed_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT uq_ncr_number UNIQUE (tenant_id, ncr_number)
);

CREATE TABLE IF NOT EXISTS corrective_action (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  ncr_id VARCHAR(64) NOT NULL REFERENCES non_conformance_record(id) ON DELETE CASCADE,
  sequence INT NOT NULL DEFAULT 1,
  action TEXT NOT NULL,
  owner_id VARCHAR(64) NOT NULL,
  owner_name VARCHAR(255),
  due_date DATE,
  status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
  completed_at TIMESTAMP WITH TIME ZONE,
  completed_by VARCHAR(64),
  verified_at TIMESTAMP WITH TIME ZONE,
  verified_by VARCHAR(64),
  evidence TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_inspection_plan_product ON inspection_plan (tenant_id, product_id, status);
CREATE INDEX IF NOT EXISTS idx_inspection_characteristic_plan ON inspection_characteristic (inspection_plan_id, sequence);
CREATE INDEX IF NOT EXISTS idx_inspection_work_order ON inspection (tenant_id, work_order_id, inspected_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspection_batch ON inspection (tenant_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_inspection_result_line ON inspection_result_line (inspection_id);
CREATE INDEX IF NOT EXISTS idx_quality_hold_open ON quality_hold (tenant_id, status, held_at DESC);
CREATE INDEX IF NOT EXISTS idx_quality_hold_work_order ON quality_hold (tenant_id, work_order_id);
CREATE INDEX IF NOT EXISTS idx_quality_disposition_inspection ON quality_disposition (tenant_id, inspection_id);
CREATE INDEX IF NOT EXISTS idx_ncr_status ON non_conformance_record (tenant_id, status, raised_at DESC);
CREATE INDEX IF NOT EXISTS idx_corrective_action_ncr ON corrective_action (ncr_id, sequence);

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'inspection_plan', 'inspection_characteristic', 'inspection', 'inspection_result_line',
    'quality_hold', 'quality_disposition', 'non_conformance_record', 'corrective_action'
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
