-- ============================================================================
-- 007  MES Improvement v1.0 — Planning Schema (MES-005)
-- ============================================================================

CREATE TABLE IF NOT EXISTS demand_forecast (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  forecast_number VARCHAR(64) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  lookback_months INT NOT NULL DEFAULT 6,
  method VARCHAR(32) NOT NULL DEFAULT 'HISTORICAL_AVERAGE',
  generated_by VARCHAR(64),
  generated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  CONSTRAINT uq_demand_forecast_num UNIQUE (tenant_id, forecast_number)
);

CREATE TABLE IF NOT EXISTS demand_forecast_line (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  demand_forecast_id VARCHAR(64) NOT NULL REFERENCES demand_forecast(id) ON DELETE CASCADE,
  customer_id VARCHAR(64) REFERENCES customer(id),
  product_id VARCHAR(64) NOT NULL REFERENCES product(id),
  historical_demand JSONB NOT NULL DEFAULT '{}'::jsonb,
  average_demand NUMERIC(12, 2) NOT NULL DEFAULT 0,
  forecast_quantity INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS capacity_plan (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  plan_number VARCHAR(64) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  planning_utilization_pct NUMERIC(5, 2) NOT NULL DEFAULT 80.0,
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  computed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_capacity_plan_num UNIQUE (tenant_id, plan_number)
);

CREATE TABLE IF NOT EXISTS capacity_plan_line (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  capacity_plan_id VARCHAR(64) NOT NULL REFERENCES capacity_plan(id) ON DELETE CASCADE,
  plant_id VARCHAR(64) NOT NULL REFERENCES plant(id),
  line_id VARCHAR(64) REFERENCES production_line(id),
  product_id VARCHAR(64) REFERENCES product(id),
  total_capacity INT NOT NULL DEFAULT 0,
  planning_capacity INT NOT NULL DEFAULT 0,
  capacity_buffer INT NOT NULL DEFAULT 0,
  demand_quantity INT NOT NULL DEFAULT 0,
  planned_quantity INT NOT NULL DEFAULT 0,
  capacity_utilization NUMERIC(6, 4) NOT NULL DEFAULT 0,
  capacity_gap INT NOT NULL DEFAULT 0,
  capacity_status VARCHAR(32) NOT NULL DEFAULT 'WITHIN_PLAN'
);

CREATE TABLE IF NOT EXISTS production_plan (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  plan_number VARCHAR(64) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  demand_forecast_id VARCHAR(64) REFERENCES demand_forecast(id),
  capacity_plan_id VARCHAR(64) REFERENCES capacity_plan(id),
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  wizard_step INT NOT NULL DEFAULT 1,
  confirmed_by VARCHAR(64),
  confirmed_at TIMESTAMP WITH TIME ZONE,
  version INT NOT NULL DEFAULT 1,
  created_by VARCHAR(64),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_prod_plan_num UNIQUE (tenant_id, plan_number)
);

CREATE TABLE IF NOT EXISTS production_plan_line (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  production_plan_id VARCHAR(64) NOT NULL REFERENCES production_plan(id) ON DELETE CASCADE,
  product_id VARCHAR(64) NOT NULL REFERENCES product(id),
  demand_quantity INT NOT NULL DEFAULT 0,
  forecast_quantity INT NOT NULL DEFAULT 0,
  planned_quantity INT NOT NULL DEFAULT 0,
  required_delivery_date DATE,
  priority INT NOT NULL DEFAULT 1,
  capacity_status VARCHAR(32) NOT NULL DEFAULT 'WITHIN_PLAN',
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS production_plan_demand (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  production_plan_line_id VARCHAR(64) NOT NULL REFERENCES production_plan_line(id) ON DELETE CASCADE,
  customer_order_id VARCHAR(64) NOT NULL REFERENCES customer_order(id),
  customer_order_line_id VARCHAR(64) NOT NULL REFERENCES customer_order_line(id),
  demand_quantity INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS capacity_up_request (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  request_number VARCHAR(64) NOT NULL,
  production_plan_id VARCHAR(64) NOT NULL REFERENCES production_plan(id),
  capacity_gap INT NOT NULL DEFAULT 0,
  response_type VARCHAR(32) NOT NULL,
  response_detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  requested_by VARCHAR(64) NOT NULL,
  requested_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  approved_by VARCHAR(64),
  approved_at TIMESTAMP WITH TIME ZONE,
  applied_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT uq_capacity_up_num UNIQUE (tenant_id, request_number)
);

-- Enable RLS
ALTER TABLE demand_forecast ENABLE ROW LEVEL SECURITY;
ALTER TABLE demand_forecast_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE capacity_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE capacity_plan_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_plan_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_plan_demand ENABLE ROW LEVEL SECURITY;
ALTER TABLE capacity_up_request ENABLE ROW LEVEL SECURITY;
