-- ============================================================================
-- 022  MES Improvement v2.0 — Bill of Materials Master Data (MES-BOM)
-- ============================================================================

CREATE TABLE IF NOT EXISTS bill_of_material (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  bom_number VARCHAR(64) NOT NULL,
  product_id VARCHAR(64) NOT NULL REFERENCES product(id),
  product_revision VARCHAR(32),
  bom_name VARCHAR(255) NOT NULL,
  version VARCHAR(32) NOT NULL DEFAULT 'v1.0',
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  description TEXT,
  created_by VARCHAR(64),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(64),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_bom_number UNIQUE (tenant_id, bom_number)
);

CREATE TABLE IF NOT EXISTS bill_of_material_item (
  id VARCHAR(64) PRIMARY KEY,
  bom_id VARCHAR(64) NOT NULL REFERENCES bill_of_material(id) ON DELETE CASCADE,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  line_number INT NOT NULL,
  component_part_id VARCHAR(64) NOT NULL REFERENCES product(id),
  component_type VARCHAR(32) NOT NULL DEFAULT 'RAW_MATERIAL',
  quantity NUMERIC(12, 4) NOT NULL,
  uom VARCHAR(32) NOT NULL,
  scrap_percentage NUMERIC(5, 2) DEFAULT 0.00,
  sequence INT DEFAULT 1,
  reference VARCHAR(128),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_bom_item_line UNIQUE (bom_id, line_number)
);

-- Enable RLS
ALTER TABLE bill_of_material ENABLE ROW LEVEL SECURITY;
ALTER TABLE bill_of_material_item ENABLE ROW LEVEL SECURITY;

-- Dropped first, as 002, 015 and 016 all do.
--
-- The runner inside the API image keeps no `schema_migrations` table — a
-- pull-based host has no checkout to record state in, so it replays every file
-- on every deploy. That makes idempotence a requirement of each migration, not
-- a nicety. These two were the only unguarded CREATE POLICY statements in the
-- tree: they succeeded the day 022 landed and failed on the next deploy with
-- `policy "rls_bill_of_material" ... already exists`, taking the whole deploy
-- down before any later migration could run.
--
-- Migration 026 replaces both with `tenant_isolation` — these were keyed on
-- `app.current_tenant_id`, a setting nothing sets. They are recreated here
-- anyway so that a replay reaches 026 in the state 026 expects.
DROP POLICY IF EXISTS rls_bill_of_material ON bill_of_material;
CREATE POLICY rls_bill_of_material ON bill_of_material
  USING (tenant_id = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS rls_bill_of_material_item ON bill_of_material_item;
CREATE POLICY rls_bill_of_material_item ON bill_of_material_item
  USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE INDEX IF NOT EXISTS idx_bom_tenant_product ON bill_of_material(tenant_id, product_id);
CREATE INDEX IF NOT EXISTS idx_bom_items_bom_id ON bill_of_material_item(bom_id);
