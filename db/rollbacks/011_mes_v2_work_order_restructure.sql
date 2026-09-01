-- ============================================================================
-- Rollback 011 — Work Order restructure (MES-010)
-- ============================================================================
-- Restores good_quantity from output_quantity before relaxing the constraints
-- that migration 011 tightened. Order matters: the column must exist and be
-- populated before anything reads it again.

-- 1. Drop the foreign key added by 011
ALTER TABLE work_order DROP CONSTRAINT IF EXISTS fk_work_order_plan_line;

-- 2. production_plan_line_id becomes optional again
ALTER TABLE work_order ALTER COLUMN production_plan_line_id DROP NOT NULL;

-- 3. Restore good_quantity and repopulate it from output_quantity.
--    output_quantity is the authoritative value; good_quantity was its
--    duplicate, so copying back loses nothing.
ALTER TABLE work_order ADD COLUMN IF NOT EXISTS good_quantity INT DEFAULT 0;
UPDATE work_order SET good_quantity = output_quantity WHERE good_quantity IS DISTINCT FROM output_quantity;

-- 4. target_quantity NOT NULL is restored only when no row would violate it
DO $$
DECLARE
  nulls INT;
BEGIN
  UPDATE work_order SET target_quantity = planned_quantity WHERE target_quantity IS NULL;
  SELECT COUNT(*) INTO nulls FROM work_order WHERE target_quantity IS NULL;
  IF nulls = 0 THEN
    ALTER TABLE work_order ALTER COLUMN target_quantity SET NOT NULL;
  END IF;
END $$;

-- 5. Clear the links this migration created. production_plan_line_id and
--    predecessor_work_order_id are columns from migration 005, so the columns
--    stay; only the values 011 wrote are removed.
UPDATE work_order SET predecessor_work_order_id = NULL;
UPDATE work_order
SET production_plan_line_id = NULL
WHERE production_plan_line_id LIKE 'planline-mig-%';
