-- ============================================================================
-- 014  MES Improvement v1.0 — Execution path backfill (E1, E2, E3)
--      MES-013 (Sprint 2), Technical Design §22 step 14
-- ============================================================================
-- has_child_work_order must reflect reality before the constraint that depends
-- on it can be trusted. Migration 005 created the column with DEFAULT FALSE and
-- never derived it from actual children.

-- --- 1. Verify before touching anything --------------------------------------
-- A parent that already carries production records violates E3, and the fix is a
-- domain decision (whose records are they?), not something a migration may
-- resolve by deleting rows.
DO $$
DECLARE
  offending      INT;
  offending_list TEXT;
BEGIN
  SELECT COUNT(*), string_agg(DISTINCT parent.id, ', ')
    INTO offending, offending_list
  FROM work_order parent
  WHERE EXISTS (SELECT 1 FROM work_order c WHERE c.parent_work_order_id = parent.id)
    AND EXISTS (SELECT 1 FROM production_record pr WHERE pr.work_order_id = parent.id);

  IF offending > 0 THEN
    RAISE EXCEPTION
      'MES-013 gate failed: % work order(s) have children AND their own production records, which E3 forbids. No record is deleted automatically. Resolve manually. Work orders: %',
      offending, offending_list;
  END IF;
END $$;

-- --- 2. Derive the flag from actual children ---------------------------------
UPDATE work_order parent
SET has_child_work_order = TRUE
WHERE has_child_work_order = FALSE
  AND EXISTS (SELECT 1 FROM work_order c WHERE c.parent_work_order_id = parent.id);

UPDATE work_order parent
SET has_child_work_order = FALSE
WHERE has_child_work_order = TRUE
  AND NOT EXISTS (SELECT 1 FROM work_order c WHERE c.parent_work_order_id = parent.id);

-- --- 3. production_record mirrors its work order ------------------------------
-- The composite foreign key keeps the two in step from here on; this brings
-- existing rows into line.
UPDATE production_record pr
SET is_batch_managed     = wo.is_batch_managed,
    has_child_work_order = wo.has_child_work_order
FROM work_order wo
WHERE pr.work_order_id = wo.id
  AND (pr.is_batch_managed IS DISTINCT FROM wo.is_batch_managed
    OR pr.has_child_work_order IS DISTINCT FROM wo.has_child_work_order);

-- --- 4. Verification ---------------------------------------------------------
DO $$
DECLARE
  e1_violation INT;
  e2_violation INT;
  e3_violation INT;
BEGIN
  SELECT COUNT(*) INTO e1_violation
  FROM production_record WHERE is_batch_managed = FALSE AND batch_id IS NOT NULL;
  IF e1_violation > 0 THEN
    RAISE EXCEPTION 'MES-013 verification failed: % production record(s) violate E1', e1_violation;
  END IF;

  SELECT COUNT(*) INTO e2_violation
  FROM production_record WHERE is_batch_managed = TRUE AND batch_id IS NULL;
  IF e2_violation > 0 THEN
    RAISE EXCEPTION 'MES-013 verification failed: % production record(s) violate E2', e2_violation;
  END IF;

  SELECT COUNT(*) INTO e3_violation
  FROM production_record WHERE has_child_work_order = TRUE;
  IF e3_violation > 0 THEN
    RAISE EXCEPTION 'MES-013 verification failed: % production record(s) violate E3', e3_violation;
  END IF;
END $$;
