-- ============================================================================
-- 015  MES Improvement v1.0 — Planning runtime support
--      Sprint 3 (MES-019, MES-020, MES-021) and the tables Sprints 4–6 write to
-- ============================================================================
-- Three things migrations 006–008 left undone, plus the storage the planning
-- module needs to exist as a module rather than as a set of loose endpoints:
--
--  1. RLS was ENABLEd on every v1.0 table but no `tenant_isolation` policy was
--     ever created for them. A table with RLS enabled and no policy denies
--     everything to a non-owner role, and the API connects as `factory_app`
--     (migration 004) precisely so the policies bind to it — so Customer Order,
--     Production Plan and Mold were unreadable and unwritable by the running
--     application. Every other tenant-scoped table got its policy in the loop
--     in migration 002; these were added afterwards and missed it.
--  2. `outbox_event`, so planning publishes ProductionPlanConfirmed and
--     CapacityGapDetected in the same transaction as the data change instead of
--     calling another module directly (MES-020).
--  3. `planning_config`, holding the two policy values §13 and §45.6 say belong
--     to the tenant rather than to the code: `planning_utilization_pct` and
--     `strict_process_sequence`.

-- === 1. Outbox (MES-020-3) ==================================================
-- Written inside the same transaction as the state change that caused it, so an
-- event cannot exist for a change that rolled back, nor a change go unannounced.
CREATE TABLE IF NOT EXISTS outbox_event (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  event_type VARCHAR(64) NOT NULL,
  aggregate_type VARCHAR(64) NOT NULL,
  aggregate_id VARCHAR(64) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TIMESTAMP WITH TIME ZONE,
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING'
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending
  ON outbox_event (tenant_id, status, occurred_at)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_outbox_aggregate
  ON outbox_event (tenant_id, aggregate_type, aggregate_id);

-- === 2. Planning configuration (§13 soft guard, §45.6 utilization) ==========
CREATE TABLE IF NOT EXISTS planning_config (
  tenant_id VARCHAR(64) PRIMARY KEY REFERENCES tenant(id),
  planning_utilization_pct NUMERIC(5, 2) NOT NULL DEFAULT 80.0,
  strict_process_sequence BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_planning_utilization CHECK (planning_utilization_pct > 0 AND planning_utilization_pct <= 100)
);

-- === 3. Customer order documents (MES-025) ==================================
-- `customer_order.document_url` holds one link; a real order arrives as a PO
-- scan plus a kanban photo plus an email, so the attachments are their own rows.
CREATE TABLE IF NOT EXISTS customer_order_document (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  customer_order_id VARCHAR(64) NOT NULL REFERENCES customer_order(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  content_type VARCHAR(128) NOT NULL,
  size_bytes INT NOT NULL,
  storage_url TEXT NOT NULL,
  uploaded_by VARCHAR(64),
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_cust_order_doc_size CHECK (size_bytes > 0)
);

CREATE INDEX IF NOT EXISTS idx_cust_order_doc
  ON customer_order_document (tenant_id, customer_order_id);

-- === 4. Columns the planning engines need ===================================
DO $$
BEGIN
  -- Forecast: "histori tidak cukup" is a reported state, not an error and not
  -- a silent zero (MES-027, §25.2).
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'demand_forecast_line' AND column_name = 'insufficient_history') THEN
    ALTER TABLE demand_forecast_line ADD COLUMN insufficient_history BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'demand_forecast_line' AND column_name = 'months_with_history') THEN
    ALTER TABLE demand_forecast_line ADD COLUMN months_with_history INT NOT NULL DEFAULT 0;
  END IF;

  -- A forecast that replaced another points at it, so a Production Plan built
  -- on the old snapshot can still explain where its numbers came from.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'demand_forecast' AND column_name = 'superseded_by_id') THEN
    ALTER TABLE demand_forecast ADD COLUMN superseded_by_id VARCHAR(64) REFERENCES demand_forecast(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'capacity_plan' AND column_name = 'superseded_by_id') THEN
    ALTER TABLE capacity_plan ADD COLUMN superseded_by_id VARCHAR(64) REFERENCES capacity_plan(id);
  END IF;

  -- Machines excluded from Total Capacity for want of an ideal cycle time.
  -- Reported, never folded into the total as a silent zero (§45.6, MES-031).
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'capacity_plan_line' AND column_name = 'uncomputed_machines') THEN
    ALTER TABLE capacity_plan_line ADD COLUMN uncomputed_machines JSONB NOT NULL DEFAULT '[]'::jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'capacity_plan_line' AND column_name = 'available_minutes') THEN
    ALTER TABLE capacity_plan_line ADD COLUMN available_minutes NUMERIC(12, 2) NOT NULL DEFAULT 0;
  END IF;

  -- The wizard is six steps and can be abandoned between any two of them
  -- (MES-039). `wizard_step` already records how far it got; this records what
  -- was entered on the way.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'production_plan' AND column_name = 'wizard_state') THEN
    ALTER TABLE production_plan ADD COLUMN wizard_state JSONB NOT NULL DEFAULT '{}'::jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'production_plan' AND column_name = 'planning_utilization_pct') THEN
    ALTER TABLE production_plan ADD COLUMN planning_utilization_pct NUMERIC(5, 2) NOT NULL DEFAULT 80.0;
  END IF;

  -- Cancellation reason: §11 makes the reason mandatory on the WO side, and
  -- MES-026 guards order cancellation the same way.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'customer_order' AND column_name = 'status_reason') THEN
    ALTER TABLE customer_order ADD COLUMN status_reason TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'work_order' AND column_name = 'status_reason') THEN
    ALTER TABLE work_order ADD COLUMN status_reason TEXT;
  END IF;

  -- Plan line carries the forecast line it was recommended from, so Step 2's
  -- prefill is traceable after the fact.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'production_plan_line' AND column_name = 'demand_forecast_line_id') THEN
    ALTER TABLE production_plan_line ADD COLUMN demand_forecast_line_id VARCHAR(64) REFERENCES demand_forecast_line(id);
  END IF;
END $$;

-- === 5. Work Order generation idempotency (MES-041-4) =======================
-- "Generate ulang TIDAK menghasilkan WO duplikat" is enforced by the database,
-- not by a read-then-write in the service: two concurrent generate calls would
-- both see nothing and both insert. Partial, because a split child shares its
-- parent's (plan line, process) and must not collide with it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wo_plan_line_process
  ON work_order (tenant_id, production_plan_line_id, process_id)
  WHERE production_plan_line_id IS NOT NULL
    AND process_id IS NOT NULL
    AND parent_work_order_id IS NULL;

-- === 6. Tenant isolation for every v1.0 table (the gap) =====================
DO $$
DECLARE
  target_table TEXT;
  tenant_scoped_tables TEXT[] := ARRAY[
    'customer', 'customer_order', 'customer_order_line', 'customer_order_document',
    'demand_forecast', 'demand_forecast_line',
    'capacity_plan', 'capacity_plan_line',
    'production_plan', 'production_plan_line', 'production_plan_demand',
    'capacity_up_request', 'mold', 'product_mold_compatibility',
    'outbox_event'
  ];
BEGIN
  FOREACH target_table IN ARRAY tenant_scoped_tables LOOP
    IF to_regclass('public.' || target_table) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target_table);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', target_table);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true))'
      || ' WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      target_table
    );
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target_table);
  END LOOP;
END $$;

-- `planning_config` is keyed by tenant_id as its primary key, so it takes the
-- same policy shape as `tenant` itself.
ALTER TABLE planning_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON planning_config;
CREATE POLICY tenant_isolation ON planning_config
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
ALTER TABLE planning_config FORCE ROW LEVEL SECURITY;

-- The app role connects with NOBYPASSRLS. ALTER DEFAULT PRIVILEGES in migration
-- 004 covers tables created by the same owner afterwards; asserted here rather
-- than assumed, because a table the application cannot read fails at runtime.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factory_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON outbox_event, planning_config, customer_order_document
      TO factory_app;
  END IF;
END $$;
