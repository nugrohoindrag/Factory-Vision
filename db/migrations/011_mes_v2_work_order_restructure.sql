-- ============================================================================
-- 011  MES Improvement v1.0 — Work Order restructure
--      MES-010 (Sprint 2), Technical Design §22 steps 4, 6, 7, 15
-- ============================================================================
-- Links every legacy Work Order to its Production Plan Line, builds the process
-- chain, and retires work_order.good_quantity.
--
-- The quantity backfill is repeated here on purpose. Migration 005 ran it once,
-- but rows written afterwards — by a seed, or by an older application build —
-- never passed through it. Backfilling again is safe because every statement is
-- guarded by "only where still empty".
--
-- Destructive step (dropping good_quantity) sits behind a verification gate:
-- output_quantity must be populated for every row that had a good_quantity
-- before the column is allowed to disappear.

-- --- 1. Link Work Order to Production Plan Line ------------------------------
UPDATE work_order wo
SET production_plan_line_id = 'planline-mig-' || wo.production_order_id
WHERE wo.production_plan_line_id IS NULL
  AND wo.production_order_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM production_plan_line pl
    WHERE pl.id = 'planline-mig-' || wo.production_order_id
  );

-- --- 2. Quantity flow backfill ----------------------------------------------
-- planned_quantity carries the old target; output_quantity carries good only.
-- Reject, scrap and rework are separate buckets (ADR-23) and must not be folded
-- into output.
UPDATE work_order
SET planned_quantity = target_quantity
WHERE planned_quantity = 0 AND target_quantity IS NOT NULL AND target_quantity > 0;

-- Guarded by existence: step 5 below drops `good_quantity`, so a replay of this
-- migration meets a schema that no longer has it. A re-migration must be a
-- no-op here, not a failure.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_order' AND column_name = 'good_quantity'
  ) THEN
    EXECUTE $sql$
      UPDATE work_order
      SET output_quantity = good_quantity
      WHERE output_quantity = 0 AND good_quantity IS NOT NULL AND good_quantity > 0
    $sql$;
  END IF;
END $$;

-- input_quantity is unknown for legacy rows: the old model never recorded what
-- entered a process. Deriving it would be a guess, so it stays 0 and Process
-- Yield simply is not computed for these rows (Architecture §10.4.1).
--
-- transferred_quantity is likewise left at 0. A legacy work order that has
-- already completed did hand its output onward, but by how much and when was
-- never recorded, and handoff figures that were invented would drive the
-- successor recommendations in Sprint 10 (MES-069) off real data.

-- --- 3. Process chain --------------------------------------------------------
-- predecessor is the previous routing step within the same plan line. Sequence
-- values in legacy data are not necessarily contiguous (1, 3, 4, 5 occurs in the
-- pilot seed), so the chain is built with LAG over the actual ordering rather
-- than by looking for sequence - 1.
WITH chain AS (
  SELECT
    id,
    LAG(id) OVER (
      PARTITION BY tenant_id, production_plan_line_id
      ORDER BY sequence, id
    ) AS prev_id
  FROM work_order
  WHERE production_plan_line_id IS NOT NULL
    AND parent_work_order_id IS NULL
)
UPDATE work_order wo
SET predecessor_work_order_id = chain.prev_id
FROM chain
WHERE wo.id = chain.id
  AND wo.predecessor_work_order_id IS NULL
  AND chain.prev_id IS NOT NULL;

-- --- 4. Verification gate before the destructive step ------------------------
DO $$
DECLARE
  unlinked INT;
  lost_output INT;
  cyclic INT;
BEGIN
  -- 4a. every work order that came from a production order must have a plan line
  SELECT COUNT(*) INTO unlinked
  FROM work_order
  WHERE production_plan_line_id IS NULL AND production_order_id IS NOT NULL;

  IF unlinked > 0 THEN
    RAISE EXCEPTION
      'MES-010 verification failed: % work order(s) have no production_plan_line_id', unlinked;
  END IF;

  -- 4b. good_quantity may only be dropped once output_quantity holds its value.
  -- On a replay the column is already gone, which means step 5 completed and
  -- the gate has nothing left to guard.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_order' AND column_name = 'good_quantity'
  ) THEN
    EXECUTE $sql$
      SELECT COUNT(*) FROM work_order
       WHERE good_quantity IS NOT NULL AND good_quantity > 0 AND output_quantity <> good_quantity
    $sql$ INTO lost_output;

    IF lost_output > 0 THEN
      RAISE EXCEPTION
        'MES-010 verification failed: % work order(s) would lose good_quantity (output_quantity does not match)', lost_output;
    END IF;
  END IF;

  -- 4c. a work order must never be its own predecessor
  SELECT COUNT(*) INTO cyclic
  FROM work_order WHERE predecessor_work_order_id = id;

  IF cyclic > 0 THEN
    RAISE EXCEPTION
      'MES-010 verification failed: % work order(s) reference themselves as predecessor', cyclic;
  END IF;
END $$;

-- --- 5. Destructive: retire work_order.good_quantity (ADR-23) ----------------
-- Identical in meaning to output_quantity. Keeping both is what produced the
-- "output = good + reject" defect in Sprint 1.
ALTER TABLE work_order DROP COLUMN IF EXISTS good_quantity;

-- --- 6. target_quantity: deprecated, not yet dropped -------------------------
-- Superseded by planned_quantity, but the column stays until Sprint 6 (step 16b)
-- so that legacy readers do not break mid-flight. Dropping NOT NULL is what
-- lets the application stop dual-writing it.
ALTER TABLE work_order ALTER COLUMN target_quantity DROP NOT NULL;

-- --- 7. production_plan_line_id becomes mandatory (step 15) -------------------
-- Only enforced when every row already satisfies it; a database that still
-- holds work orders without a plan line fails at 4a above, before reaching here.
DO $$
DECLARE
  orphans INT;
BEGIN
  SELECT COUNT(*) INTO orphans FROM work_order WHERE production_plan_line_id IS NULL;
  IF orphans = 0 THEN
    ALTER TABLE work_order ALTER COLUMN production_plan_line_id SET NOT NULL;
  ELSE
    RAISE NOTICE
      'MES-010: % work order(s) without production_plan_line_id; NOT NULL not applied', orphans;
  END IF;
END $$;

-- --- 8. Foreign key now that the target table exists -------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_work_order_plan_line') THEN
    ALTER TABLE work_order
      ADD CONSTRAINT fk_work_order_plan_line
      FOREIGN KEY (production_plan_line_id) REFERENCES production_plan_line(id);
  END IF;
END $$;
