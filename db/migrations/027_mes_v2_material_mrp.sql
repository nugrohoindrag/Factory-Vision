-- ============================================================================
-- 027  MES Improvement v2.0 — Material, Inventory and MRP (PRD §3, §13, §15)
-- ============================================================================
--
-- Material is a product row. The BOM already points its components at
-- `product(id)` (022), and a raw material that lived in its own master would
-- have to be reconciled with that on every explosion — two tables, one
-- concept, and a shortage report that disagrees with the BOM it came from.
--
-- The ledger is `material_transaction`. Every change to `material_inventory`
-- writes one, carrying the balance it produced, so "why is stock 7,000" has an
-- answer that does not require replaying the whole history.

-- --------------------------------------------------------------------------
-- Warehouse: where stock physically sits (§3.1 "availability by warehouse").
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS warehouse (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  plant_id VARCHAR(64) REFERENCES plant(id),
  code VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  warehouse_type VARCHAR(32) NOT NULL DEFAULT 'RAW_MATERIAL',
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_warehouse_code UNIQUE (tenant_id, code)
);

-- --------------------------------------------------------------------------
-- On-hand stock, one row per material per warehouse.
--
-- `available_quantity` is stored rather than computed on read because the
-- board, the readiness check and MRP all sort and filter on it; the writers
-- keep it equal to on_hand - reserved + incoming (§3.1).
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS material_inventory (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  material_id VARCHAR(64) NOT NULL REFERENCES product(id),
  warehouse_id VARCHAR(64) NOT NULL REFERENCES warehouse(id),
  uom VARCHAR(32) NOT NULL DEFAULT 'PCS',
  on_hand_quantity NUMERIC(16, 4) NOT NULL DEFAULT 0,
  reserved_quantity NUMERIC(16, 4) NOT NULL DEFAULT 0,
  incoming_quantity NUMERIC(16, 4) NOT NULL DEFAULT 0,
  available_quantity NUMERIC(16, 4) NOT NULL DEFAULT 0,
  reorder_point NUMERIC(16, 4),
  safety_stock NUMERIC(16, 4),
  state VARCHAR(32) NOT NULL DEFAULT 'AVAILABLE',
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_material_inventory UNIQUE (tenant_id, material_id, warehouse_id)
);

-- --------------------------------------------------------------------------
-- Reservation: stock promised to a work order but not yet issued.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS material_reservation (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  material_id VARCHAR(64) NOT NULL REFERENCES product(id),
  warehouse_id VARCHAR(64) REFERENCES warehouse(id),
  work_order_id VARCHAR(64) REFERENCES work_order(id),
  production_plan_id VARCHAR(64),
  quantity NUMERIC(16, 4) NOT NULL,
  uom VARCHAR(32) NOT NULL DEFAULT 'PCS',
  status VARCHAR(32) NOT NULL DEFAULT 'RESERVED',
  reserved_by VARCHAR(64) NOT NULL,
  reserved_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at TIMESTAMP WITH TIME ZONE,
  notes TEXT
);

-- --------------------------------------------------------------------------
-- Requirement: one exploded BOM line resolved against inventory (§3.1).
--
-- Persisted rather than recomputed on every read so that a readiness check has
-- a timestamp and can be compared with the one from yesterday — "material was
-- READY when we scheduled it" is a claim someone will need to make.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS material_requirement (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  source_type VARCHAR(32) NOT NULL,
  source_id VARCHAR(64) NOT NULL,
  source_label VARCHAR(128),
  material_id VARCHAR(64) NOT NULL REFERENCES product(id),
  bom_id VARCHAR(64),
  level INT NOT NULL DEFAULT 1,
  required_quantity NUMERIC(16, 4) NOT NULL DEFAULT 0,
  on_hand_quantity NUMERIC(16, 4) NOT NULL DEFAULT 0,
  reserved_quantity NUMERIC(16, 4) NOT NULL DEFAULT 0,
  incoming_quantity NUMERIC(16, 4) NOT NULL DEFAULT 0,
  available_quantity NUMERIC(16, 4) NOT NULL DEFAULT 0,
  shortage_quantity NUMERIC(16, 4) NOT NULL DEFAULT 0,
  uom VARCHAR(32) NOT NULL DEFAULT 'PCS',
  requirement_date DATE,
  status VARCHAR(32) NOT NULL DEFAULT 'NOT_CHECKED',
  warehouse_id VARCHAR(64) REFERENCES warehouse(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_material_requirement UNIQUE (tenant_id, source_type, source_id, material_id, level)
);

-- --------------------------------------------------------------------------
-- Consumption (§3.3, BR-M05: always against a work order).
--
-- `idempotency_key` is unique per tenant so an offline terminal replaying its
-- queue records the issue once (§38).
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS material_consumption (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  work_order_id VARCHAR(64) NOT NULL REFERENCES work_order(id),
  batch_id VARCHAR(64) REFERENCES production_batch(id),
  process_id VARCHAR(64) REFERENCES production_process(id),
  machine_id VARCHAR(64) REFERENCES machine(id),
  material_id VARCHAR(64) NOT NULL REFERENCES product(id),
  warehouse_id VARCHAR(64) REFERENCES warehouse(id),
  planned_quantity NUMERIC(16, 4) NOT NULL DEFAULT 0,
  actual_quantity NUMERIC(16, 4) NOT NULL DEFAULT 0,
  variance_quantity NUMERIC(16, 4) NOT NULL DEFAULT 0,
  uom VARCHAR(32) NOT NULL DEFAULT 'PCS',
  consumption_type VARCHAR(32) NOT NULL DEFAULT 'PRODUCTION',
  status VARCHAR(32) NOT NULL DEFAULT 'NORMAL',
  operator_id VARCHAR(64) REFERENCES operator(id),
  recorded_by VARCHAR(64) NOT NULL,
  consumed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  idempotency_key VARCHAR(128),
  notes TEXT,
  CONSTRAINT uq_material_consumption_idem UNIQUE (tenant_id, idempotency_key)
);

-- --------------------------------------------------------------------------
-- The stock ledger. Append-only in practice; every inventory write adds one.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS material_transaction (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  material_id VARCHAR(64) NOT NULL REFERENCES product(id),
  warehouse_id VARCHAR(64) REFERENCES warehouse(id),
  transaction_type VARCHAR(32) NOT NULL,
  quantity NUMERIC(16, 4) NOT NULL,
  uom VARCHAR(32) NOT NULL DEFAULT 'PCS',
  balance_after NUMERIC(16, 4) NOT NULL DEFAULT 0,
  reference_type VARCHAR(64),
  reference_id VARCHAR(64),
  reason TEXT,
  actor_id VARCHAR(64) NOT NULL,
  actor_name VARCHAR(255),
  occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------------------------------------------------------
-- MRP (§3.2). A run is a snapshot: BR-M08 requires the horizon and the
-- timestamp to be stored with it, because a net requirement is only meaningful
-- against the inventory it was computed from.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mrp_run (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  run_number VARCHAR(64) NOT NULL,
  horizon_start DATE NOT NULL,
  horizon_end DATE NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'RUNNING',
  demand_source VARCHAR(32) NOT NULL DEFAULT 'PRODUCTION_PLAN',
  plan_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_materials INT NOT NULL DEFAULT 0,
  shortage_materials INT NOT NULL DEFAULT 0,
  run_by VARCHAR(64) NOT NULL,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  notes TEXT,
  CONSTRAINT uq_mrp_run_number UNIQUE (tenant_id, run_number)
);

CREATE TABLE IF NOT EXISTS mrp_result (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  mrp_run_id VARCHAR(64) NOT NULL REFERENCES mrp_run(id) ON DELETE CASCADE,
  material_id VARCHAR(64) NOT NULL REFERENCES product(id),
  level INT NOT NULL DEFAULT 1,
  gross_requirement NUMERIC(16, 4) NOT NULL DEFAULT 0,
  on_hand_quantity NUMERIC(16, 4) NOT NULL DEFAULT 0,
  reserved_quantity NUMERIC(16, 4) NOT NULL DEFAULT 0,
  incoming_quantity NUMERIC(16, 4) NOT NULL DEFAULT 0,
  available_quantity NUMERIC(16, 4) NOT NULL DEFAULT 0,
  net_requirement NUMERIC(16, 4) NOT NULL DEFAULT 0,
  uom VARCHAR(32) NOT NULL DEFAULT 'PCS',
  requirement_date DATE,
  requirement_source VARCHAR(255),
  status VARCHAR(32) NOT NULL DEFAULT 'READY',
  recommendation TEXT
);

CREATE INDEX IF NOT EXISTS idx_material_inventory_material ON material_inventory (tenant_id, material_id);
CREATE INDEX IF NOT EXISTS idx_material_reservation_wo ON material_reservation (tenant_id, work_order_id);
CREATE INDEX IF NOT EXISTS idx_material_reservation_material ON material_reservation (tenant_id, material_id, status);
CREATE INDEX IF NOT EXISTS idx_material_requirement_source ON material_requirement (tenant_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_material_requirement_status ON material_requirement (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_material_consumption_wo ON material_consumption (tenant_id, work_order_id);
CREATE INDEX IF NOT EXISTS idx_material_consumption_material ON material_consumption (tenant_id, material_id, consumed_at DESC);
CREATE INDEX IF NOT EXISTS idx_material_transaction_material ON material_transaction (tenant_id, material_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_material_transaction_reference ON material_transaction (tenant_id, reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_mrp_run_started ON mrp_run (tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_mrp_result_run ON mrp_result (mrp_run_id, status);

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'warehouse', 'material_inventory', 'material_reservation', 'material_requirement',
    'material_consumption', 'material_transaction', 'mrp_run', 'mrp_result'
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

  -- The stock ledger is evidence of what moved, so the application appends to
  -- it and never rewrites it — the same control `audit_log` gets in 023.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factory_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON material_transaction FROM factory_app;
    GRANT SELECT, INSERT ON material_transaction TO factory_app;
  END IF;
END $$;
