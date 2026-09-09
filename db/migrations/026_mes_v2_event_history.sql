-- ============================================================================
-- 026  MES Improvement v2.0 — Operational Event History (Improvement PRD §10)
-- ============================================================================
--
-- The audit trail answers "who changed which field". It is a security control
-- and it is written from the API's write paths, which is why it carries
-- before/after values and nothing about the shop floor around them.
--
-- Event History answers a different question, the one a supervisor asks at
-- 09:42: what happened to this work order, in order, with the machine, the
-- operator and the batch attached (§10.1). The two are kept apart on purpose —
-- an operational timeline that doubled as the audit trail would either be too
-- noisy to read or too sparse to be evidence.
--
-- Append-only by privilege, not by convention (BR-E01, BR-E02): the
-- application may read and insert, and nothing else. Same control as
-- `audit_log` in 023.

CREATE TABLE IF NOT EXISTS operational_event (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  event_type VARCHAR(64) NOT NULL,

  -- The subject of the event. Every event has exactly one, and the timeline of
  -- an entity is "every event whose subject or context mentions it" (BR-E04).
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(64) NOT NULL,

  actor_type VARCHAR(16) NOT NULL DEFAULT 'USER',
  actor_id VARCHAR(64),
  actor_name VARCHAR(255),

  occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Denormalised context (§10.4). Copied at write time rather than joined at
  -- read time: a timeline has to stay truthful about where the work ran even
  -- after the work order is re-assigned to another machine.
  plant_id VARCHAR(64),
  line_id VARCHAR(64),
  machine_id VARCHAR(64),
  process_id VARCHAR(64),
  work_order_id VARCHAR(64),
  batch_id VARCHAR(64),

  -- One line of Indonesian, rendered by the writer, so the timeline reads
  -- without the console having to know every event type that will ever exist.
  summary TEXT NOT NULL,
  before_value JSONB,
  after_value JSONB,
  metadata JSONB,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_operational_event_entity
  ON operational_event (tenant_id, entity_type, entity_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_operational_event_recent
  ON operational_event (tenant_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_operational_event_work_order
  ON operational_event (tenant_id, work_order_id, occurred_at DESC)
  WHERE work_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_operational_event_machine
  ON operational_event (tenant_id, machine_id, occurred_at DESC)
  WHERE machine_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_operational_event_batch
  ON operational_event (tenant_id, batch_id, occurred_at DESC)
  WHERE batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_operational_event_type
  ON operational_event (tenant_id, event_type, occurred_at DESC);

ALTER TABLE operational_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_event FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'operational_event' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON operational_event
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factory_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON operational_event FROM factory_app;
    GRANT SELECT, INSERT ON operational_event TO factory_app;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Repair: 022 keyed the BOM policies on `app.current_tenant_id`.
--
-- Nothing sets that name — `withTenant` sets `app.tenant_id` — so the policy
-- evaluated to NULL = tenant_id for every row and the tables were invisible to
-- the application role. It went unnoticed because the BOM service kept its
-- rows in memory. Material planning reads BOM from the database, so the policy
-- has to be the one the connection actually declares.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bill_of_material' AND policyname = 'rls_bill_of_material') THEN
    DROP POLICY rls_bill_of_material ON bill_of_material;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bill_of_material_item' AND policyname = 'rls_bill_of_material_item') THEN
    DROP POLICY rls_bill_of_material_item ON bill_of_material_item;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bill_of_material' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON bill_of_material
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bill_of_material_item' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON bill_of_material_item
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

ALTER TABLE bill_of_material FORCE ROW LEVEL SECURITY;
ALTER TABLE bill_of_material_item FORCE ROW LEVEL SECURITY;
