-- ============================================================================
-- 031  MES Improvement v2.0 — WIP and Transactional Handoff (PRD §7, §8, §18)
-- ============================================================================
--
-- v1.7 moved quantity between processes implicitly: a work order recorded a
-- transferred quantity and the next one recorded an input quantity, and the
-- two were assumed to be the same number. They usually are, and the interesting
-- cases are the ones where they are not — 1,000 sent, 950 arrived, and nothing
-- anywhere says where the other 50 went.
--
-- So the handoff becomes a transaction (§8): a transfer is created, and a
-- receipt records what actually arrived, with a reason for the difference
-- (BR-WIP04). The WIP row in between is the quantity that exists but is not
-- finished — the thing §7 makes an operational object.

CREATE TABLE IF NOT EXISTS wip_record (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  wip_number VARCHAR(64) NOT NULL,
  product_id VARCHAR(64) NOT NULL REFERENCES product(id),
  work_order_id VARCHAR(64) NOT NULL REFERENCES work_order(id),
  batch_id VARCHAR(64) REFERENCES production_batch(id),
  source_process_id VARCHAR(64) REFERENCES production_process(id),
  destination_process_id VARCHAR(64) REFERENCES production_process(id),
  quantity NUMERIC(16, 4) NOT NULL DEFAULT 0,
  uom VARCHAR(32) NOT NULL DEFAULT 'PCS',
  status VARCHAR(32) NOT NULL DEFAULT 'CREATED',
  location_id VARCHAR(64),
  location_name VARCHAR(255),
  -- §16's quality state travels with the WIP, because BR-WIP05 says a held
  -- quantity cannot be used and the check has to be answerable from the row.
  quality_status VARCHAR(32) NOT NULL DEFAULT 'PENDING_INSPECTION',
  created_by VARCHAR(64) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  CONSTRAINT uq_wip_number UNIQUE (tenant_id, wip_number)
);

CREATE TABLE IF NOT EXISTS wip_transfer (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  transfer_number VARCHAR(64) NOT NULL,
  wip_id VARCHAR(64) NOT NULL REFERENCES wip_record(id),
  product_id VARCHAR(64) NOT NULL REFERENCES product(id),
  batch_id VARCHAR(64) REFERENCES production_batch(id),
  source_work_order_id VARCHAR(64) NOT NULL REFERENCES work_order(id),
  source_process_id VARCHAR(64) REFERENCES production_process(id),
  destination_work_order_id VARCHAR(64) REFERENCES work_order(id),
  destination_process_id VARCHAR(64) REFERENCES production_process(id),
  quantity NUMERIC(16, 4) NOT NULL,
  uom VARCHAR(32) NOT NULL DEFAULT 'PCS',
  status VARCHAR(32) NOT NULL DEFAULT 'CREATED',
  created_by VARCHAR(64) NOT NULL,
  created_by_name VARCHAR(255),
  transferred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  receipt_id VARCHAR(64),
  idempotency_key VARCHAR(128),
  notes TEXT,
  CONSTRAINT uq_wip_transfer_number UNIQUE (tenant_id, transfer_number),
  CONSTRAINT uq_wip_transfer_idem UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS wip_receipt (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  wip_transfer_id VARCHAR(64) NOT NULL REFERENCES wip_transfer(id),
  received_quantity NUMERIC(16, 4) NOT NULL DEFAULT 0,
  transferred_quantity NUMERIC(16, 4) NOT NULL DEFAULT 0,
  variance_quantity NUMERIC(16, 4) NOT NULL DEFAULT 0,
  variance_reason TEXT,
  result VARCHAR(16) NOT NULL DEFAULT 'FULL',
  uom VARCHAR(32) NOT NULL DEFAULT 'PCS',
  received_by VARCHAR(64) NOT NULL,
  received_by_name VARCHAR(255),
  received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  idempotency_key VARCHAR(128),
  notes TEXT,
  CONSTRAINT uq_wip_receipt_idem UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS wip_status_history (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  wip_id VARCHAR(64) NOT NULL REFERENCES wip_record(id) ON DELETE CASCADE,
  from_status VARCHAR(32),
  to_status VARCHAR(32) NOT NULL,
  changed_by VARCHAR(64) NOT NULL,
  changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_wip_record_status ON wip_record (tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_wip_record_work_order ON wip_record (tenant_id, work_order_id);
CREATE INDEX IF NOT EXISTS idx_wip_record_process ON wip_record (tenant_id, destination_process_id, status);
CREATE INDEX IF NOT EXISTS idx_wip_transfer_source ON wip_transfer (tenant_id, source_work_order_id);
CREATE INDEX IF NOT EXISTS idx_wip_transfer_status ON wip_transfer (tenant_id, status, transferred_at DESC);
CREATE INDEX IF NOT EXISTS idx_wip_receipt_transfer ON wip_receipt (wip_transfer_id);
CREATE INDEX IF NOT EXISTS idx_wip_status_history_wip ON wip_status_history (wip_id, changed_at);

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['wip_record', 'wip_transfer', 'wip_receipt', 'wip_status_history'] LOOP
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
