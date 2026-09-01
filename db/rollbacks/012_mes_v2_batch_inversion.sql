-- ============================================================================
-- Rollback 012 — Batch relationship inversion (MES-011)
-- ============================================================================
-- Rebuilds the legacy shape from the identity map: the fanned-out rows collapse
-- back into the single batch they came from, and work_order.batch_id is restored
-- for every work order that had one.
--
-- production_batch is NOT dropped. It was created by migration 001, and dropping
-- it here is exactly the defect Sprint 1 shipped and had to correct.

-- 1. work_order_id becomes optional again
ALTER TABLE production_batch ALTER COLUMN work_order_id DROP NOT NULL;

-- 2. Restore the legacy pointer column
ALTER TABLE work_order ADD COLUMN IF NOT EXISTS batch_id VARCHAR(64);

-- 3. Re-create the legacy batch rows from the identity map. Column values come
--    from any one fanned-out sibling: they were cloned from the same legacy row,
--    so they all still agree.
INSERT INTO production_batch (
  id, tenant_id, batch_number, work_order_id, product_id, process_id, sequence,
  planned_quantity, input_quantity, output_quantity,
  reject_quantity, scrap_quantity, rework_quantity, transferred_quantity,
  status, production_order_id, production_date
)
SELECT DISTINCT ON (m.legacy_batch_id)
  m.legacy_batch_id,
  m.tenant_id,
  m.legacy_batch_number,
  NULL,                      -- the legacy shape had no single owner
  pb.product_id,
  NULL,                      -- process_id did not exist on the legacy row
  1,
  0, 0, 0, 0, 0, 0, 0,       -- legacy batches carried no quantities
  pb.status,
  pb.production_order_id,
  pb.production_date
FROM migration_batch_identity_map m
JOIN production_batch pb ON pb.id = m.new_batch_id
WHERE NOT EXISTS (SELECT 1 FROM production_batch x WHERE x.id = m.legacy_batch_id)
ORDER BY m.legacy_batch_id, m.process_sequence
ON CONFLICT (id) DO NOTHING;

-- 4. Point every work order back at its legacy batch
UPDATE work_order wo
SET batch_id = m.legacy_batch_id
FROM migration_batch_identity_map m
WHERE m.work_order_id = wo.id;

-- 5. Work orders whose batch was never fanned out (single-reference case) point
--    back at the batch that still names them as owner.
UPDATE work_order wo
SET batch_id = pb.id
FROM production_batch pb
WHERE pb.work_order_id = wo.id
  AND wo.batch_id IS NULL
  AND pb.id !~ '-s[0-9]+$';

-- 6. Remove the fanned-out rows and the map itself
DELETE FROM production_batch WHERE id IN (SELECT new_batch_id FROM migration_batch_identity_map);
DROP TABLE IF EXISTS migration_batch_identity_map;

-- 7. Re-create the foreign key migration 001 had
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_order_batch_id_fkey') THEN
    ALTER TABLE work_order
      ADD CONSTRAINT work_order_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES production_batch(id);
  END IF;
END $$;
