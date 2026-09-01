-- ============================================================================
-- 021  One machine, one running Work Order — and the same for a mould
-- ============================================================================
--
-- Architecture section 891 describes the race directly: two operators start a
-- Work Order on the same machine at the same moment. Its answer has two halves
-- — a distributed lock while the transaction runs, and "constraint database
-- bahwa satu mesin hanya boleh punya satu WO berstatus IN_PRODUCTION", applied
-- to `mold_id` as well because one physical mould cannot sit in two machines.
--
-- Neither half was ever built. The lock is the optional one: it makes the loser
-- of the race fail early and politely. The constraint is not optional, because
-- it is the only thing that makes the invariant true regardless of how many API
-- processes are running — and Sprint 7 has just made a second process (the
-- worker) a normal part of the deployment.
--
-- Partial unique indexes rather than table constraints: the rule only applies
-- to rows in one state, and a work order that has finished must be free to
-- share a machine with the next one.
--
-- Applied without a data repair on purpose: a duplicate here would mean two
-- Work Orders genuinely believed to be running on one machine, which a
-- migration must not silently pick a winner for. The index build fails loudly
-- instead, and the verification block below explains what to look at.

DO $exclusivity$
DECLARE
  machine_conflicts INT;
  mold_conflicts INT;
BEGIN
  SELECT count(*) INTO machine_conflicts FROM (
    SELECT 1 FROM work_order
     WHERE status = 'IN_PRODUCTION' AND machine_id IS NOT NULL
     GROUP BY tenant_id, machine_id HAVING count(*) > 1
  ) AS c;

  SELECT count(*) INTO mold_conflicts FROM (
    SELECT 1 FROM work_order
     WHERE status = 'IN_PRODUCTION' AND mold_id IS NOT NULL
     GROUP BY tenant_id, mold_id HAVING count(*) > 1
  ) AS c;

  IF machine_conflicts > 0 OR mold_conflicts > 0 THEN
    RAISE EXCEPTION
      'Tidak dapat menerapkan exclusivity: % mesin dan % mold memiliki lebih dari satu work order IN_PRODUCTION. Selesaikan atau batalkan salah satunya lebih dulu.',
      machine_conflicts, mold_conflicts;
  END IF;
END $exclusivity$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_work_order_machine_in_production
  ON work_order (tenant_id, machine_id)
  WHERE status = 'IN_PRODUCTION' AND machine_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_work_order_mold_in_production
  ON work_order (tenant_id, mold_id)
  WHERE status = 'IN_PRODUCTION' AND mold_id IS NOT NULL;
