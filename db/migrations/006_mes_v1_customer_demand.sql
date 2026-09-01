-- ============================================================================
-- 006  MES Improvement v1.0 — Customer & Demand Schema (MES-004)
-- ============================================================================

CREATE TABLE IF NOT EXISTS customer (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  code VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  pic_name VARCHAR(255),
  pic_contact VARCHAR(255),
  delivery_address TEXT,
  dock_number VARCHAR(64),
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_customer_code UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS customer_order (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  order_number VARCHAR(64) NOT NULL,
  customer_id VARCHAR(64) NOT NULL REFERENCES customer(id),
  po_number VARCHAR(64),
  order_channel VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
  order_date DATE NOT NULL,
  requested_delivery_date DATE NOT NULL,
  customer_pic VARCHAR(255),
  delivery_address TEXT,
  dock_number VARCHAR(64),
  document_url TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'RECEIVED',
  created_by VARCHAR(64),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_cust_order_num UNIQUE (tenant_id, order_number)
);

CREATE TABLE IF NOT EXISTS customer_order_line (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  customer_order_id VARCHAR(64) NOT NULL REFERENCES customer_order(id) ON DELETE CASCADE,
  product_id VARCHAR(64) NOT NULL REFERENCES product(id),
  model_type VARCHAR(64),
  ordered_quantity INT NOT NULL,
  unit VARCHAR(32) NOT NULL DEFAULT 'PCS',
  requested_delivery_date DATE,
  planned_quantity INT NOT NULL DEFAULT 0,
  produced_quantity INT NOT NULL DEFAULT 0,
  line_no INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_cust_order_line_planned CHECK (planned_quantity <= ordered_quantity)
);

-- Enable RLS
ALTER TABLE customer ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_order_line ENABLE ROW LEVEL SECURITY;
