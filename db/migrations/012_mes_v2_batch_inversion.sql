-- ============================================================================
-- 012  MES Improvement v1.0 — Batch relationship inversion, completed
--      MES-011 (Sprint 2), Technical Design §22 steps 10, 11
-- ============================================================================
-- Migration 005 added production_batch.work_order_id and backfilled it. This
-- migration resolves the shape mismatch the backfill could not, then removes the
-- legacy pointer work_order.batch_id.
--
-- THE SHAPE MISMATCH
--   legacy : many Work Orders  ->  one Batch   (a batch flowed along the routing)
--   v1.0   : one  Work Order   ->  many Batches (ADR-29)
--
-- A batch referenced by four routing steps has no single owner under the new
-- model, and picking one would be a guess. It is therefore FANNED OUT: one batch
-- per referencing Work Order, keyed by that work order's process sequence.
--
-- QUANTITY
--   Legacy production_batch (migration 001) had no quantity columns at all —
--   id, tenant_id, batch_number, product_id, production_order_id,
--   production_date, status and nothing else. The seven quantity columns arrived
--   in migration 005 with DEFAULT 0. There is consequently no legacy quantity to
--   divide between the fanned-out rows, and none is invented here: every new row
--   starts at zero, which is what the old model actually recorded.
--   Gate 5e below fails the migration if that ever stops being true, so a
--   database that does carry batch quantities cannot be split silently.
--
-- IDENTITY
--   batch_number is a business identifier (Naming Convention §9A), so the legacy
--   value is never overwritten in place. Fanned-out rows take a derived identity
--   'B260829-01-S3', and every legacy -> derived pair is recorded in
--   migration_batch_identity_map so the mapping stays auditable after the legacy
--   row is gone.
--
--   Batches referenced by exactly one Work Order are NOT renamed: their mapping
--   is already unambiguous, and changing a business identifier without cause
--   would be gratuitous.

-- --- 1. Audit mapping table --------------------------------------------------
CREATE TABLE IF NOT EXISTS migration_batch_identity_map (
  id                   VARCHAR(64) PRIMARY KEY,
  tenant_id            VARCHAR(64) NOT NULL,
  legacy_batch_id      VARCHAR(64) NOT NULL,
  legacy_batch_number  VARCHAR(64) NOT NULL,
  new_batch_id         VARCHAR(64) NOT NULL,
  new_batch_number     VARCHAR(64) NOT NULL,
  work_order_id        VARCHAR(64) NOT NULL,
  process_sequence     INT,
  migrated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_batch_identity_legacy
  ON migration_batch_identity_map (tenant_id, legacy_batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_identity_new
  ON migration_batch_identity_map (tenant_id, new_batch_id);

-- --- 2 & 3. Legacy-pointer work, guarded ------------------------------------
-- Everything from here to section 4 reads `work_order.batch_id`, which step 6
-- of this same migration drops. A replay therefore meets a schema without it,
-- and must be a no-op rather than a failure — "migrasi dapat dieksekusi ulang"
-- is part of the Sprint 2 exit criteria, not an extra.
--
-- PL/pgSQL plans a statement on first execution, so the early RETURN keeps the
-- statements below from ever being parsed against the newer schema.
DO $inversion$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_order' AND column_name = 'batch_id'
  ) THEN
    RAISE NOTICE 'work_order.batch_id sudah tidak ada: inversi batch telah dijalankan, langkah 2-3 dilewati.';
    RETURN;
  END IF;

  -- --- 2. Deterministic backfill for the unambiguous cases ---------------------
  -- Single-reference batches, and rows written after migration 005 ran.
  UPDATE production_batch pb
  SET work_order_id = wo.id
  FROM work_order wo
  WHERE wo.batch_id = pb.id
    AND (pb.work_order_id IS NULL OR pb.work_order_id = '')
    AND (SELECT COUNT(*) FROM work_order w2 WHERE w2.batch_id = pb.id) = 1;

  -- A batch referenced by a production record belongs to that record's work
  -- order. This is a fact in the data, not an inference.
  UPDATE production_batch pb
  SET work_order_id = pr.work_order_id
  FROM production_record pr
  WHERE pr.batch_id = pb.id
    AND (pb.work_order_id IS NULL OR pb.work_order_id = '');

  -- --- 3. Fan out the ambiguous ones -------------------------------------------
  -- Only batches referenced by more than one Work Order. One new row per
  -- referencing work order, identified by that work order's routing sequence.

  -- 3a. Release the owner migration 005 picked for these rows. It chose whichever
  --     work order the join happened to return, which is precisely the guess this
  --     migration exists to undo — and it also collides with the fanned-out row
  --     for that same work order on uq_prod_batch_wo_seq.
  UPDATE production_batch pb
  SET work_order_id = NULL
  WHERE pb.id IN (
    SELECT pb2.id
    FROM production_batch pb2
    JOIN work_order wo ON wo.batch_id = pb2.id
    GROUP BY pb2.id
    HAVING COUNT(*) > 1
  );

  -- 3b. Create one batch per referencing work order.
  WITH multi AS (
    SELECT pb.id AS legacy_id
    FROM production_batch pb
    JOIN work_order wo ON wo.batch_id = pb.id
    GROUP BY pb.id
    HAVING COUNT(*) > 1
  ),
  fanout AS (
    SELECT
      pb.id                                        AS legacy_id,
      pb.batch_number                              AS legacy_number,
      pb.tenant_id,
      pb.product_id,
      pb.production_order_id,
      pb.production_date,
      pb.status,
      wo.id                                        AS work_order_id,
      wo.process_id,
      COALESCE(wo.sequence, 0)                     AS process_sequence,
      pb.id || '-s' || COALESCE(wo.sequence, 0)    AS new_id,
      pb.batch_number || '-S' || COALESCE(wo.sequence, 0) AS new_number,
      -- Several legacy batches can fan out onto the same work order. Ordering
      -- by legacy id keeps the numbering reproducible across replays.
      ROW_NUMBER() OVER (PARTITION BY wo.id ORDER BY pb.id) AS fan_rank
    FROM production_batch pb
    JOIN multi   m  ON m.legacy_id = pb.id
    JOIN work_order wo ON wo.batch_id = pb.id
  ),
  -- `sequence` is the batch's position within its work order, and it is unique
  -- per work order (uq_prod_batch_wo_seq). A fixed 1 was wrong: a work order
  -- that already owns a historical lot at sequence 1 — a completed or scrapped
  -- batch that step 3a does not release, because it is referenced by only that
  -- one work order — collides with the fanned-out row the moment it is written.
  -- The new rows therefore continue the numbering rather than restart it.
  numbered AS (
    SELECT
      f.*,
      COALESCE(
        (SELECT MAX(x.sequence)
           FROM production_batch x
          WHERE x.tenant_id = f.tenant_id
            AND x.work_order_id = f.work_order_id),
        0
      ) + f.fan_rank AS new_sequence
    FROM fanout f
  )
  INSERT INTO production_batch (
    id, tenant_id, batch_number, work_order_id, product_id, process_id, sequence,
    planned_quantity, input_quantity, output_quantity,
    reject_quantity, scrap_quantity, rework_quantity, transferred_quantity,
    status, production_order_id, production_date
  )
  SELECT
    f.new_id, f.tenant_id, f.new_number, f.work_order_id, f.product_id, f.process_id,
    f.new_sequence,
    -- Zero throughout: the legacy model recorded no batch quantities (see header).
    0, 0, 0, 0, 0, 0, 0,
    f.status, f.production_order_id, f.production_date
  FROM numbered f
  WHERE NOT EXISTS (SELECT 1 FROM production_batch x WHERE x.id = f.new_id)
  ON CONFLICT (id) DO NOTHING;
END $inversion$;

-- --- 4. Record the identity mapping ------------------------------------------
INSERT INTO migration_batch_identity_map (
  id, tenant_id, legacy_batch_id, legacy_batch_number,
  new_batch_id, new_batch_number, work_order_id, process_sequence
)
SELECT
  'bidmap-' || pb_new.id,
  pb_new.tenant_id,
  regexp_replace(pb_new.id, '-s[0-9]+$', ''),
  regexp_replace(pb_new.batch_number, '-S[0-9]+$', ''),
  pb_new.id,
  pb_new.batch_number,
  pb_new.work_order_id,
  -- the routing sequence that produced the suffix, not the batch's own
  -- sequence within its work order (which is always 1 for a fanned-out row)
  CAST(substring(pb_new.id from '-s([0-9]+)$') AS INT)
FROM production_batch pb_new
WHERE pb_new.id ~ '-s[0-9]+$'
  AND NOT EXISTS (
    SELECT 1 FROM migration_batch_identity_map m WHERE m.id = 'bidmap-' || pb_new.id
  );

-- --- 5. Verification gates ---------------------------------------------------
-- Everything after this block is destructive.
DO $$
DECLARE
  orphan_count   INT;
  orphan_list    TEXT;
  dup_identity   INT;
  unmapped_wo    INT;
  legacy_qty     BIGINT;
  fanout_qty     BIGINT;
  map_count      INT;
  expected_map   INT;
BEGIN
  -- 5a. no batch may be left without an owner, and none is ever guessed
  SELECT COUNT(*), string_agg(id || ' (' || batch_number || ')', ', ' ORDER BY id)
    INTO orphan_count, orphan_list
  FROM production_batch
  WHERE (work_order_id IS NULL OR work_order_id = '')
    AND id NOT IN (SELECT legacy_batch_id FROM migration_batch_identity_map);

  IF orphan_count > 0 THEN
    RAISE EXCEPTION
      'MES-011 gate 5a failed: % orphan batch(es) have no work_order_id and will NOT be guessed. Resolve manually, then re-run. Batches: %',
      orphan_count, orphan_list;
  END IF;

  -- 5b. business identity must stay unique per tenant
  SELECT COUNT(*) INTO dup_identity FROM (
    SELECT tenant_id, batch_number FROM production_batch
    GROUP BY tenant_id, batch_number HAVING COUNT(*) > 1
  ) d;

  IF dup_identity > 0 THEN
    RAISE EXCEPTION 'MES-011 gate 5b failed: % duplicate batch_number(s) per tenant', dup_identity;
  END IF;

  -- 5c. every Work Order that had a batch linkage keeps a representation.
  --     Skipped on a replay: the legacy pointer is gone, which means step 6
  --     already ran and this gate has nothing left to check.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_order' AND column_name = 'batch_id'
  ) THEN
    EXECUTE $gate$
      SELECT COUNT(*) FROM work_order wo
       WHERE wo.batch_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM production_batch pb WHERE pb.work_order_id = wo.id)
    $gate$ INTO unmapped_wo;

    IF unmapped_wo > 0 THEN
      RAISE EXCEPTION
        'MES-011 gate 5c failed: % work order(s) had a batch linkage but now have no batch', unmapped_wo;
    END IF;
  END IF;

  -- 5d. mapping row count must equal the number of fanned-out batches
  SELECT COUNT(*) INTO map_count FROM migration_batch_identity_map;
  SELECT COUNT(*) INTO expected_map FROM production_batch WHERE id ~ '-s[0-9]+$';

  IF map_count <> expected_map THEN
    RAISE EXCEPTION
      'MES-011 gate 5d failed: identity map holds % row(s) for % fanned-out batch(es)',
      map_count, expected_map;
  END IF;

  -- 5e. quantity conservation. Legacy batches carry zero (see header); if a
  --     database ever arrives with real quantities on a multi-referenced batch,
  --     splitting it is a domain decision and this migration must not guess.
  SELECT COALESCE(SUM(planned_quantity + input_quantity + output_quantity
                    + reject_quantity + scrap_quantity + rework_quantity
                    + transferred_quantity), 0)
    INTO legacy_qty
  FROM production_batch
  WHERE id IN (SELECT DISTINCT legacy_batch_id FROM migration_batch_identity_map);

  IF legacy_qty > 0 THEN
    RAISE EXCEPTION
      'MES-011 gate 5e failed: legacy batch(es) carry non-zero quantities (total %). Splitting them across processes is a domain decision, not a migration one. STOP and obtain a rule.',
      legacy_qty;
  END IF;

  SELECT COALESCE(SUM(planned_quantity + input_quantity + output_quantity
                    + reject_quantity + scrap_quantity + rework_quantity
                    + transferred_quantity), 0)
    INTO fanout_qty
  FROM production_batch WHERE id ~ '-s[0-9]+$';

  IF fanout_qty <> legacy_qty THEN
    RAISE EXCEPTION
      'MES-011 gate 5e failed: quantity not conserved (legacy=%, fanned-out=%)', legacy_qty, fanout_qty;
  END IF;
END $$;

-- --- 6. Destructive: drop the legacy pointer ---------------------------------
-- Done before deleting the legacy rows: work_order.batch_id has a foreign key
-- onto production_batch, so the rows cannot go first.
ALTER TABLE work_order DROP COLUMN IF EXISTS batch_id;

-- --- 7. Destructive: remove the legacy rows that were fanned out -------------
-- Their identity survives in migration_batch_identity_map.
DELETE FROM production_batch
WHERE id IN (SELECT DISTINCT legacy_batch_id FROM migration_batch_identity_map);

-- --- 8. work_order_id becomes mandatory (step 11) ----------------------------
ALTER TABLE production_batch ALTER COLUMN work_order_id SET NOT NULL;

-- --- 9. production_batch.production_order_id stays ---------------------------
-- Dropped in Sprint 6 with the production_order table (step 16b). Already
-- nullable and unused by new writes; removing it early would break the legacy
-- readers that still exist.
