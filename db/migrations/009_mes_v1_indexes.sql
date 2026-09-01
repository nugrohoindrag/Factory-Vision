-- ============================================================================
-- 009  MES Improvement v1.0 — Database Index Set (MES-007)
-- ============================================================================

-- 1. Planning & Demand Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_order_unique ON customer_order (tenant_id, order_number);
CREATE INDEX IF NOT EXISTS idx_customer_order_status_deliv ON customer_order (tenant_id, status, requested_delivery_date);
CREATE INDEX IF NOT EXISTS idx_customer_order_line_lookup ON customer_order_line (tenant_id, product_id, customer_order_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_production_plan_unique ON production_plan (tenant_id, plan_number);
CREATE INDEX IF NOT EXISTS idx_production_plan_line_lookup ON production_plan_line (tenant_id, production_plan_id, product_id);
CREATE INDEX IF NOT EXISTS idx_prod_plan_demand_col ON production_plan_demand (tenant_id, customer_order_line_id);
CREATE INDEX IF NOT EXISTS idx_prod_plan_demand_ppl ON production_plan_demand (tenant_id, production_plan_line_id);

-- 2. Work Order Indexes
CREATE INDEX IF NOT EXISTS idx_work_order_plan_line ON work_order (tenant_id, production_plan_line_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_order_generate_idempotency ON work_order (tenant_id, production_plan_line_id, process_id, parent_work_order_id)
  WHERE parent_work_order_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_work_order_parent ON work_order (tenant_id, parent_work_order_id)
  WHERE parent_work_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_order_predecessor ON work_order (tenant_id, predecessor_work_order_id)
  WHERE predecessor_work_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_order_machine_schedule ON work_order (tenant_id, machine_id, planned_start);
CREATE INDEX IF NOT EXISTS idx_work_order_mold_schedule ON work_order (tenant_id, mold_id, planned_start)
  WHERE mold_id IS NOT NULL;

-- 3. Batch Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_production_batch_num ON production_batch (tenant_id, batch_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_production_batch_wo_seq ON production_batch (tenant_id, work_order_id, sequence);
CREATE INDEX IF NOT EXISTS idx_production_batch_status_active ON production_batch (tenant_id, status)
  WHERE status IN ('PLANNED', 'IN_PRODUCTION');
CREATE INDEX IF NOT EXISTS idx_production_batch_date_proc ON production_batch (tenant_id, production_date, process_id);
CREATE INDEX IF NOT EXISTS idx_production_record_batch ON production_record (tenant_id, batch_id);

-- 4. Master Compatibility Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_mold_compat_unique ON product_mold_compatibility (tenant_id, product_id, mold_id);
