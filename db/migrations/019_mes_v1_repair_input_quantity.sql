-- ============================================================================
-- 019  Repair work_order.input_quantity (§10 invariant)
-- ============================================================================
-- DEFECT
--   `recordOutput` incremented `output_quantity` and `reject_quantity` on the
--   work order but never `input_quantity`, and the production record's own
--   `input_quantity` was left at 0. Nine work orders in the pilot database
--   ended up with, for example, input 0 / output 0 / reject 18 — which breaks
--   §10's first invariant and yields a WIP of −18.
--
--   Anything derived from those counters was wrong: WIP, Process Yield, and the
--   quantity-flow panel a planner reads to decide whether a process is losing
--   material.
--
-- ROOT CAUSE
--   The write path never consulted `QuantityFlowService`. MES-017 enforces the
--   invariant in the domain layer, but the domain layer was not on the path
--   that writes. The code fix wires it in; this repairs what was already stored.
--
-- REPAIR RULE
--   `input_quantity` is raised to exactly what the dispositions account for:
--   output + reject + scrap + rework. Nothing is invented — every one of those
--   units demonstrably entered the process, because it came out of it in some
--   state. Rows that already satisfy the invariant are left alone, so a row
--   carrying genuine WIP keeps it.

-- --- Work orders -------------------------------------------------------------
UPDATE work_order
SET input_quantity = output_quantity + reject_quantity + scrap_quantity + rework_quantity,
    updated_at = now()
WHERE input_quantity < output_quantity + reject_quantity + scrap_quantity + rework_quantity;

-- --- Batches (identical invariant, §9 Q5) ------------------------------------
UPDATE production_batch
SET input_quantity = output_quantity + reject_quantity + scrap_quantity + rework_quantity,
    updated_at = CURRENT_TIMESTAMP
WHERE input_quantity < output_quantity + reject_quantity + scrap_quantity + rework_quantity;

-- --- Production records ------------------------------------------------------
-- The event rows carry their own input, used by the per-record quantity flow.
UPDATE production_record
SET input_quantity = good_quantity + reject_quantity
                     + COALESCE(scrap_quantity, 0) + COALESCE(rework_quantity, 0)
WHERE input_quantity < good_quantity + reject_quantity
                       + COALESCE(scrap_quantity, 0) + COALESCE(rework_quantity, 0);

-- --- Gate: the repair must actually have worked ------------------------------
DO $$
DECLARE
  bad_wo INT;
  bad_batch INT;
BEGIN
  SELECT COUNT(*) INTO bad_wo FROM work_order
   WHERE input_quantity < output_quantity + reject_quantity + scrap_quantity + rework_quantity
      OR transferred_quantity > output_quantity;
  SELECT COUNT(*) INTO bad_batch FROM production_batch
   WHERE input_quantity < output_quantity + reject_quantity + scrap_quantity + rework_quantity
      OR transferred_quantity > output_quantity;

  IF bad_wo > 0 OR bad_batch > 0 THEN
    RAISE EXCEPTION
      'Repair 019 gagal: % work order dan % batch masih melanggar invarian quantity flow.',
      bad_wo, bad_batch;
  END IF;
END $$;
