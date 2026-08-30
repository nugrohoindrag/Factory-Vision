-- Factory Vision - Complete Database Migration
-- PostgreSQL 15+ compatible with Row Level Security (RLS)
-- Aligned with PRD v1.5 & Technical Architecture v1.8

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- === TENANCY & MASTER DATA ===
CREATE TABLE IF NOT EXISTS tenant (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  timezone VARCHAR(64) DEFAULT 'Asia/Jakarta',
  plan VARCHAR(64) DEFAULT 'MID_MARKET',
  status VARCHAR(32) DEFAULT 'ACTIVE',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS plant (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  name VARCHAR(255) NOT NULL,
  location TEXT,
  timezone VARCHAR(64) DEFAULT 'Asia/Jakarta',
  status VARCHAR(32) DEFAULT 'ACTIVE'
);

CREATE TABLE IF NOT EXISTS production_line (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  plant_id VARCHAR(64) NOT NULL REFERENCES plant(id),
  code VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(32) DEFAULT 'ACTIVE',
  planned_production_time_minutes INT DEFAULT 480
);

CREATE TABLE IF NOT EXISTS work_center (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  production_line_id VARCHAR(64) NOT NULL REFERENCES production_line(id),
  code VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  sequence INT DEFAULT 1
);

CREATE TABLE IF NOT EXISTS production_process (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  code VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  sequence_default INT DEFAULT 1,
  status VARCHAR(32) DEFAULT 'ACTIVE',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS machine (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  work_center_id VARCHAR(64) NOT NULL REFERENCES work_center(id),
  code VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(32) DEFAULT 'ACTIVE',
  ideal_cycle_time_seconds NUMERIC(10, 2) NOT NULL,
  current_state VARCHAR(32) DEFAULT 'IDLE',
  current_state_since TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  sku VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  unit VARCHAR(32) DEFAULT 'PCS',
  ideal_cycle_time_seconds NUMERIC(10, 2) NOT NULL,
  status VARCHAR(32) DEFAULT 'ACTIVE'
);

CREATE TABLE IF NOT EXISTS product_machine_rate (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  product_id VARCHAR(64) NOT NULL REFERENCES product(id),
  machine_id VARCHAR(64) NOT NULL REFERENCES machine(id),
  ideal_cycle_time_seconds NUMERIC(10, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS product_routing (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  product_id VARCHAR(64) NOT NULL REFERENCES product(id),
  process_id VARCHAR(64) NOT NULL REFERENCES production_process(id),
  sequence INT NOT NULL,
  work_center_id VARCHAR(64) REFERENCES work_center(id),
  machine_id VARCHAR(64) REFERENCES machine(id),
  standard_cycle_time_seconds NUMERIC(10, 2),
  active BOOLEAN DEFAULT TRUE,
  CONSTRAINT uq_product_routing_seq UNIQUE (tenant_id, product_id, sequence)
);

CREATE TABLE IF NOT EXISTS operator (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  employee_number VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  pin_hash VARCHAR(255),
  default_line_id VARCHAR(64) REFERENCES production_line(id),
  status VARCHAR(32) DEFAULT 'ACTIVE'
);

CREATE TABLE IF NOT EXISTS shift (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  plant_id VARCHAR(64) NOT NULL REFERENCES plant(id),
  name VARCHAR(64) NOT NULL,
  start_time VARCHAR(8) NOT NULL,
  end_time VARCHAR(8) NOT NULL,
  break_minutes INT DEFAULT 60,
  crosses_midnight BOOLEAN DEFAULT FALSE,
  active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS downtime_reason (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  parent_id VARCHAR(64),
  category VARCHAR(32) NOT NULL,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_planned BOOLEAN DEFAULT FALSE,
  active BOOLEAN DEFAULT TRUE,
  sort_order INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS downtime_reason_scope (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  reason_id VARCHAR(64) NOT NULL REFERENCES downtime_reason(id),
  line_id VARCHAR(64) REFERENCES production_line(id),
  work_center_id VARCHAR(64) REFERENCES work_center(id)
);

CREATE TABLE IF NOT EXISTS reject_reason (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  parent_id VARCHAR(64),
  category VARCHAR(32) NOT NULL,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  active BOOLEAN DEFAULT TRUE,
  sort_order INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reject_reason_scope (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  reason_id VARCHAR(64) NOT NULL REFERENCES reject_reason(id),
  product_id VARCHAR(64) REFERENCES product(id),
  work_center_id VARCHAR(64) REFERENCES work_center(id)
);

-- === TRANSACTIONAL & EXECUTION ===
CREATE TABLE IF NOT EXISTS production_order (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  order_number VARCHAR(64) NOT NULL,
  product_id VARCHAR(64) NOT NULL REFERENCES product(id),
  quantity INT NOT NULL,
  due_date DATE NOT NULL,
  status VARCHAR(32) DEFAULT 'DRAFT',
  created_by VARCHAR(64),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS production_batch (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  batch_number VARCHAR(64) NOT NULL,
  product_id VARCHAR(64) NOT NULL REFERENCES product(id),
  production_order_id VARCHAR(64) NOT NULL REFERENCES production_order(id),
  production_date DATE NOT NULL,
  status VARCHAR(32) DEFAULT 'ACTIVE',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_prod_batch_num UNIQUE (tenant_id, batch_number)
);

CREATE TABLE IF NOT EXISTS work_order (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  production_order_id VARCHAR(64) NOT NULL REFERENCES production_order(id),
  wo_number VARCHAR(64) NOT NULL,
  product_id VARCHAR(64) NOT NULL REFERENCES product(id),
  process_id VARCHAR(64) REFERENCES production_process(id),
  sequence INT DEFAULT 1,
  batch_id VARCHAR(64) REFERENCES production_batch(id),
  line_id VARCHAR(64) NOT NULL REFERENCES production_line(id),
  work_center_id VARCHAR(64),
  machine_id VARCHAR(64),
  target_quantity INT NOT NULL,
  unit VARCHAR(32) DEFAULT 'PCS',
  planned_start TIMESTAMP WITH TIME ZONE NOT NULL,
  planned_end TIMESTAMP WITH TIME ZONE NOT NULL,
  actual_start TIMESTAMP WITH TIME ZONE,
  actual_end TIMESTAMP WITH TIME ZONE,
  good_quantity INT DEFAULT 0,
  reject_quantity INT DEFAULT 0,
  status VARCHAR(32) DEFAULT 'DRAFT',
  priority INT DEFAULT 1,
  version INT DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- === EVENTS (Immutable, Partitioned by month in production) ===
CREATE TABLE IF NOT EXISTS production_record (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  work_order_id VARCHAR(64) NOT NULL REFERENCES work_order(id),
  process_id VARCHAR(64) REFERENCES production_process(id),
  batch_id VARCHAR(64) REFERENCES production_batch(id),
  machine_id VARCHAR(64) NOT NULL,
  operator_id VARCHAR(64) NOT NULL,
  shift_id VARCHAR(64) NOT NULL,
  shift_date DATE NOT NULL,
  good_quantity INT DEFAULT 0,
  reject_quantity INT DEFAULT 0,
  reject_reason_id VARCHAR(64),
  recorded_at TIMESTAMP WITH TIME ZONE NOT NULL,
  source VARCHAR(32) DEFAULT 'OPERATOR_MANUAL',
  client_event_id VARCHAR(64) NOT NULL,
  correction_of_id VARCHAR(64),
  notes TEXT,
  CONSTRAINT uq_prod_record_client_event UNIQUE (tenant_id, client_event_id)
);

CREATE TABLE IF NOT EXISTS downtime_record (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  work_order_id VARCHAR(64),
  process_id VARCHAR(64) REFERENCES production_process(id),
  machine_id VARCHAR(64) NOT NULL,
  line_id VARCHAR(64) NOT NULL,
  operator_id VARCHAR(64),
  shift_id VARCHAR(64) NOT NULL,
  shift_date DATE NOT NULL,
  reason_id VARCHAR(64) NOT NULL,
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE,
  duration_seconds INT,
  is_planned BOOLEAN DEFAULT FALSE,
  notes TEXT,
  client_event_id VARCHAR(64) NOT NULL,
  status VARCHAR(32) DEFAULT 'ACTIVE',
  CONSTRAINT uq_dt_record_client_event UNIQUE (tenant_id, client_event_id)
);

CREATE TABLE IF NOT EXISTS machine_state_log (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  machine_id VARCHAR(64) NOT NULL,
  process_id VARCHAR(64) REFERENCES production_process(id),
  state VARCHAR(32) NOT NULL,
  reason_id VARCHAR(64),
  started_at TIMESTAMP WITH TIME ZONE NOT NULL,
  ended_at TIMESTAMP WITH TIME ZONE,
  duration_seconds INT,
  work_order_id VARCHAR(64),
  shift_date DATE
);

CREATE TABLE IF NOT EXISTS shift_session (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  line_id VARCHAR(64) NOT NULL REFERENCES production_line(id),
  shift_id VARCHAR(64) NOT NULL REFERENCES shift(id),
  shift_date DATE NOT NULL,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL,
  ended_at TIMESTAMP WITH TIME ZONE,
  supervisor_id VARCHAR(64),
  target_quantity INT DEFAULT 0,
  handover_notes TEXT,
  status VARCHAR(32) DEFAULT 'ACTIVE'
);

-- === DERIVED & AGGREGATES ===
CREATE TABLE IF NOT EXISTS oee_daily (
  tenant_id VARCHAR(64) NOT NULL,
  shift_date DATE NOT NULL,
  plant_id VARCHAR(64) NOT NULL,
  line_id VARCHAR(64) NOT NULL,
  process_id VARCHAR(64),
  work_center_id VARCHAR(64),
  machine_id VARCHAR(64) NOT NULL,
  shift_id VARCHAR(64) NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  planned_time_seconds INT NOT NULL,
  run_time_seconds INT NOT NULL,
  downtime_seconds INT NOT NULL,
  good_count INT NOT NULL,
  reject_count INT NOT NULL,
  total_count INT NOT NULL,
  availability NUMERIC(6, 4) NOT NULL,
  performance NUMERIC(6, 4) NOT NULL,
  quality NUMERIC(6, 4) NOT NULL,
  oee NUMERIC(6, 4) NOT NULL,
  calc_version INT DEFAULT 1,
  computed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  revised_at TIMESTAMP WITH TIME ZONE,
  revision_count INT DEFAULT 0,
  PRIMARY KEY (tenant_id, shift_date, plant_id, line_id, machine_id, shift_id, product_id)
);

-- === PLATFORM, GOVERNANCE & AUDIT ===
CREATE TABLE IF NOT EXISTS app_user (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255),
  name VARCHAR(255) NOT NULL,
  role VARCHAR(64) NOT NULL,
  account_type VARCHAR(32) DEFAULT 'APPLICATION_USER',
  scope_level VARCHAR(32) DEFAULT 'TENANT',
  scope_id VARCHAR(64),
  employee_number VARCHAR(64),
  status VARCHAR(32) DEFAULT 'ACTIVE',
  last_login_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS device_terminal (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  device_code VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  assigned_line_id VARCHAR(64) REFERENCES production_line(id),
  assigned_work_center_id VARCHAR(64) REFERENCES work_center(id),
  status VARCHAR(32) DEFAULT 'ONLINE',
  ip_address VARCHAR(64),
  last_heartbeat_at TIMESTAMP WITH TIME ZONE,
  registered_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS correction_request (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(64) NOT NULL,
  shift_date DATE NOT NULL,
  field_changes JSONB NOT NULL,
  reason TEXT NOT NULL,
  requested_by VARCHAR(64) NOT NULL,
  requested_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  requires_approval BOOLEAN DEFAULT TRUE,
  approved_by VARCHAR(64),
  approved_at TIMESTAMP WITH TIME ZONE,
  rejected_by VARCHAR(64),
  rejected_at TIMESTAMP WITH TIME ZONE,
  status VARCHAR(32) DEFAULT 'PENDING',
  applied_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS audit_log (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  actor_type VARCHAR(32) NOT NULL,
  actor_id VARCHAR(64) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(64) NOT NULL,
  action VARCHAR(64) NOT NULL,
  previous_value JSONB,
  new_value JSONB,
  ip VARCHAR(64),
  user_agent TEXT,
  occurred_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS kpi_target (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  metric VARCHAR(64) NOT NULL,
  target_value NUMERIC(10, 2) NOT NULL,
  unit VARCHAR(32) NOT NULL,
  direction VARCHAR(32) DEFAULT 'HIGHER_IS_BETTER',
  watch_threshold_pct NUMERIC(6, 2) DEFAULT 95.0,
  critical_threshold_pct NUMERIC(6, 2) DEFAULT 90.0
);

-- === ROW LEVEL SECURITY (RLS) ACTIVATION ===
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE plant ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_center ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_process ENABLE ROW LEVEL SECURITY;
ALTER TABLE machine ENABLE ROW LEVEL SECURITY;
ALTER TABLE product ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_routing ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE downtime_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE machine_state_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE oee_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_terminal ENABLE ROW LEVEL SECURITY;
ALTER TABLE correction_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_target ENABLE ROW LEVEL SECURITY;
