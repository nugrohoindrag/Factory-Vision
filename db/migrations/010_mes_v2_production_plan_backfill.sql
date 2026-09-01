-- ============================================================================
-- 010  MES Improvement v1.0 — Production Order → Production Plan backfill
--      MES-009 (Sprint 2), Technical Design §22 step 3 + 16a
-- ============================================================================
-- Every legacy production_order becomes exactly one production_plan and exactly
-- one production_plan_line, so that dropping the Production Order entity later
-- (step 16b, Sprint 6) loses no history.
--
-- production_order itself is NOT dropped here. It becomes legacy read-only: 64
-- code references still read it, and their replacement lands in Sprint 5-6.
--
-- Idempotency comes from deterministic ids ('plan-mig-<po_id>'), not from a
-- flag column. Re-running inserts nothing new, and rollback can therefore
-- delete exactly what this migration created without touching plans authored by
-- hand.

-- --- 1. production_plan ------------------------------------------------------
-- plan_number follows Naming Convention §9A: PLAN-YYYYMM-NNN, numbered per
-- tenant and month. The offset counts plans that already exist for that
-- tenant/month so a second run, or a hand-made plan, cannot collide.
WITH candidate AS (
  SELECT
    po.id,
    po.tenant_id,
    po.product_id,
    po.quantity,
    po.due_date,
    po.status,
    po.created_by,
    po.created_at,
    po.order_number,
    to_char(po.due_date, 'YYYYMM') AS period_key,
    ROW_NUMBER() OVER (
      PARTITION BY po.tenant_id, to_char(po.due_date, 'YYYYMM')
      ORDER BY po.order_number, po.id
    ) AS seq
  FROM production_order po
  WHERE NOT EXISTS (
    SELECT 1 FROM production_plan pp WHERE pp.id = 'plan-mig-' || po.id
  )
),
offsets AS (
  SELECT
    c.tenant_id,
    c.period_key,
    COALESCE((
      SELECT COUNT(*) FROM production_plan pp
      WHERE pp.tenant_id = c.tenant_id
        AND pp.plan_number LIKE 'PLAN-' || c.period_key || '-%'
    ), 0) AS base
  FROM (SELECT DISTINCT tenant_id, period_key FROM candidate) c
)
INSERT INTO production_plan (
  id, tenant_id, plan_number, period_start, period_end,
  status, wizard_step, version, created_by, created_at, updated_at
)
SELECT
  'plan-mig-' || c.id,
  c.tenant_id,
  'PLAN-' || c.period_key || '-' || lpad((o.base + c.seq)::text, 3, '0'),
  LEAST(c.created_at::date, c.due_date),
  c.due_date,
  CASE c.status
    WHEN 'DRAFT'         THEN 'DRAFT'
    WHEN 'PLANNED'       THEN 'PLANNING'
    WHEN 'RELEASED'      THEN 'CONFIRMED'
    WHEN 'IN_PRODUCTION' THEN 'IN_EXECUTION'
    WHEN 'COMPLETED'     THEN 'COMPLETED'
    WHEN 'CANCELLED'     THEN 'CANCELLED'
    ELSE 'DRAFT'
  END,
  6,
  1,
  c.created_by,
  c.created_at,
  c.created_at
FROM candidate c
JOIN offsets o ON o.tenant_id = c.tenant_id AND o.period_key = c.period_key
ON CONFLICT (id) DO NOTHING;

-- --- 2. production_plan_line -------------------------------------------------
-- One line per plan: the legacy Production Order carried a single product.
-- demand_quantity and planned_quantity both take the order quantity — the old
-- model had no separate demand figure, and inventing one would be a guess.
INSERT INTO production_plan_line (
  id, tenant_id, production_plan_id, product_id,
  demand_quantity, forecast_quantity, planned_quantity,
  required_delivery_date, priority, capacity_status, status,
  created_at, updated_at
)
SELECT
  'planline-mig-' || po.id,
  po.tenant_id,
  'plan-mig-' || po.id,
  po.product_id,
  po.quantity,
  0,
  po.quantity,
  po.due_date,
  1,
  'WITHIN_PLAN',
  CASE po.status
    WHEN 'DRAFT'         THEN 'DRAFT'
    WHEN 'PLANNED'       THEN 'PLANNING'
    WHEN 'RELEASED'      THEN 'CONFIRMED'
    WHEN 'IN_PRODUCTION' THEN 'IN_EXECUTION'
    WHEN 'COMPLETED'     THEN 'COMPLETED'
    WHEN 'CANCELLED'     THEN 'CANCELLED'
    ELSE 'DRAFT'
  END,
  po.created_at,
  po.created_at
FROM production_order po
WHERE EXISTS (SELECT 1 FROM production_plan pp WHERE pp.id = 'plan-mig-' || po.id)
  AND NOT EXISTS (
    SELECT 1 FROM production_plan_line pl WHERE pl.id = 'planline-mig-' || po.id
  )
ON CONFLICT (id) DO NOTHING;

-- --- 3. Verification gate ----------------------------------------------------
-- A production order without a plan line means history was lost. Fail loudly
-- rather than let the next migration build on an incomplete mapping.
DO $$
DECLARE
  unmapped INT;
  qty_before BIGINT;
  qty_after BIGINT;
BEGIN
  SELECT COUNT(*) INTO unmapped
  FROM production_order po
  WHERE NOT EXISTS (
    SELECT 1 FROM production_plan_line pl WHERE pl.id = 'planline-mig-' || po.id
  );

  IF unmapped > 0 THEN
    RAISE EXCEPTION
      'MES-009 verification failed: % production_order row(s) have no production_plan_line', unmapped;
  END IF;

  SELECT COALESCE(SUM(quantity), 0) INTO qty_before FROM production_order;
  SELECT COALESCE(SUM(pl.planned_quantity), 0) INTO qty_after
  FROM production_plan_line pl
  WHERE pl.id LIKE 'planline-mig-%';

  IF qty_before <> qty_after THEN
    RAISE EXCEPTION
      'MES-009 verification failed: quantity not conserved (production_order=%, plan_line=%)',
      qty_before, qty_after;
  END IF;
END $$;
