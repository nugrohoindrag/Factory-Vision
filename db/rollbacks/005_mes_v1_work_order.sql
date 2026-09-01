-- ============================================================================
-- Rollback 005 Work Order & Batch (MES-001, MES-002, MES-003, MES-115)
-- Non-destructive rollback: preserves production_batch base table created in 001
-- ============================================================================

-- 1. Drop constraints from production_record
ALTER TABLE production_record DROP CONSTRAINT IF EXISTS ck_prod_record_not_parent;
ALTER TABLE production_record DROP CONSTRAINT IF EXISTS ck_prod_record_batch_exclusive;
ALTER TABLE production_record DROP CONSTRAINT IF EXISTS fk_prod_record_batch_wo;
ALTER TABLE production_record DROP CONSTRAINT IF EXISTS fk_prod_record_wo_exec_mode;
ALTER TABLE production_record DROP CONSTRAINT IF EXISTS fk_prod_record_wo_mode;

-- 2. Drop columns added to production_record in migration 005
ALTER TABLE production_record DROP COLUMN IF EXISTS input_quantity;
ALTER TABLE production_record DROP COLUMN IF EXISTS rework_quantity;
ALTER TABLE production_record DROP COLUMN IF EXISTS scrap_quantity;
ALTER TABLE production_record DROP COLUMN IF EXISTS has_child_work_order;
ALTER TABLE production_record DROP COLUMN IF EXISTS is_batch_managed;

-- 3. Drop constraints and indexes added to production_batch in migration 005
DROP INDEX IF EXISTS idx_prod_batch_wo;
ALTER TABLE production_batch DROP CONSTRAINT IF EXISTS uq_batch_wo;
ALTER TABLE production_batch DROP CONSTRAINT IF EXISTS uq_prod_batch_wo_seq;
ALTER TABLE production_batch DROP CONSTRAINT IF EXISTS fk_prod_batch_work_order;
ALTER TABLE production_batch DROP CONSTRAINT IF EXISTS fk_prod_batch_process;
ALTER TABLE production_batch DROP CONSTRAINT IF EXISTS fk_prod_batch_mold;

-- 4. Drop columns added to production_batch in migration 005 (WITHOUT dropping the table)
ALTER TABLE production_batch DROP COLUMN IF EXISTS updated_at;
ALTER TABLE production_batch DROP COLUMN IF EXISTS version;
ALTER TABLE production_batch DROP COLUMN IF EXISTS actual_end;
ALTER TABLE production_batch DROP COLUMN IF EXISTS actual_start;
ALTER TABLE production_batch DROP COLUMN IF EXISTS expiry_date;
ALTER TABLE production_batch DROP COLUMN IF EXISTS shift_id;
ALTER TABLE production_batch DROP COLUMN IF EXISTS operator_id;
ALTER TABLE production_batch DROP COLUMN IF EXISTS mold_id;
ALTER TABLE production_batch DROP COLUMN IF EXISTS machine_id;
ALTER TABLE production_batch DROP COLUMN IF EXISTS material_lot_reference;
ALTER TABLE production_batch DROP COLUMN IF EXISTS status_reason;
ALTER TABLE production_batch DROP COLUMN IF EXISTS transferred_quantity;
ALTER TABLE production_batch DROP COLUMN IF EXISTS rework_quantity;
ALTER TABLE production_batch DROP COLUMN IF EXISTS scrap_quantity;
ALTER TABLE production_batch DROP COLUMN IF EXISTS reject_quantity;
ALTER TABLE production_batch DROP COLUMN IF EXISTS output_quantity;
ALTER TABLE production_batch DROP COLUMN IF EXISTS input_quantity;
ALTER TABLE production_batch DROP COLUMN IF EXISTS planned_quantity;
ALTER TABLE production_batch DROP COLUMN IF EXISTS sequence;
ALTER TABLE production_batch DROP COLUMN IF EXISTS process_id;
ALTER TABLE production_batch DROP COLUMN IF EXISTS work_order_id;

-- 5. Drop constraints from work_order
ALTER TABLE work_order DROP CONSTRAINT IF EXISTS uq_wo_exec_mode;
ALTER TABLE work_order DROP CONSTRAINT IF EXISTS uq_wo_batch_mode;
ALTER TABLE work_order DROP CONSTRAINT IF EXISTS fk_work_order_parent;
ALTER TABLE work_order DROP CONSTRAINT IF EXISTS fk_work_order_predecessor;
ALTER TABLE work_order DROP CONSTRAINT IF EXISTS fk_work_order_mold;

-- 6. Drop columns added to work_order in migration 005
ALTER TABLE work_order DROP COLUMN IF EXISTS confirmed_at;
ALTER TABLE work_order DROP COLUMN IF EXISTS confirmed_by;
ALTER TABLE work_order DROP COLUMN IF EXISTS transferred_quantity;
ALTER TABLE work_order DROP COLUMN IF EXISTS rework_quantity;
ALTER TABLE work_order DROP COLUMN IF EXISTS scrap_quantity;
ALTER TABLE work_order DROP COLUMN IF EXISTS output_quantity;
ALTER TABLE work_order DROP COLUMN IF EXISTS input_quantity;
ALTER TABLE work_order DROP COLUMN IF EXISTS planned_quantity;
ALTER TABLE work_order DROP COLUMN IF EXISTS shift_id;
ALTER TABLE work_order DROP COLUMN IF EXISTS mold_id;
ALTER TABLE work_order DROP COLUMN IF EXISTS has_child_work_order;
ALTER TABLE work_order DROP COLUMN IF EXISTS is_batch_managed;
ALTER TABLE work_order DROP COLUMN IF EXISTS predecessor_work_order_id;
ALTER TABLE work_order DROP COLUMN IF EXISTS parent_work_order_id;
ALTER TABLE work_order DROP COLUMN IF EXISTS routing_id;
ALTER TABLE work_order DROP COLUMN IF EXISTS production_plan_line_id;
