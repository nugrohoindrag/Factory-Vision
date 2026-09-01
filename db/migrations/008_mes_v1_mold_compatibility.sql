-- ============================================================================
-- 008  MES Improvement v1.0 — Mold & Compatibility Master (MES-006)
-- ============================================================================

CREATE TABLE IF NOT EXISTS mold (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  code VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  cavity_count INT NOT NULL DEFAULT 1,
  status VARCHAR(32) NOT NULL DEFAULT 'AVAILABLE',
  current_machine_id VARCHAR(64) REFERENCES machine(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_mold_code UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS product_mold_compatibility (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  product_id VARCHAR(64) NOT NULL REFERENCES product(id),
  mold_id VARCHAR(64) NOT NULL REFERENCES mold(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_prod_mold_compat UNIQUE (tenant_id, product_id, mold_id)
);

-- Enable RLS
ALTER TABLE mold ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_mold_compatibility ENABLE ROW LEVEL SECURITY;

-- Add FK from work_order and production_batch to mold
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_work_order_mold') THEN
    ALTER TABLE work_order ADD CONSTRAINT fk_work_order_mold FOREIGN KEY (mold_id) REFERENCES mold(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_prod_batch_mold') THEN
    ALTER TABLE production_batch ADD CONSTRAINT fk_prod_batch_mold FOREIGN KEY (mold_id) REFERENCES mold(id);
  END IF;
END $$;
