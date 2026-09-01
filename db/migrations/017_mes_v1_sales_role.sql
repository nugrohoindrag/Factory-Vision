-- ============================================================================
-- 017  SALES role, and the Sprint 3–6 planning permissions
-- ============================================================================
-- Two things, both one-off data migrations against `role_definition` /
-- `role_permission`:
--
--  1. **SALES becomes a system role.** Improvement PRD §5 and §8.1 make Order
--     Receiving Sales' decision and everything downstream of it PPIC's. Until
--     now the enum had no Sales, so the workflow was exercised by PPIC — which
--     described the ownership correctly nowhere and enforced it nowhere.
--
--  2. **The planning permissions reach the roles that already exist.** The
--     application materialises baseline roles only for a tenant that has none,
--     which is right — §22.4 lets a tenant retune a system role, and re-applying
--     the baseline on every boot would undo that. The consequence is that every
--     permission introduced after a tenant was provisioned (all of
--     `customer_order:*`, `demand_forecast:*`, `capacity_plan:*`,
--     `production_plan:*`) was inert for existing tenants. Granting them is a
--     deliberate, reviewable step, so it lives here rather than in a boot path.
--
-- Ownership moves with the permissions: PPIC keeps `customer_order:view`,
-- because demand is what it plans against, and loses create/edit/cancel and
-- `customer:manage`.
--
-- Idempotent throughout: every insert is ON CONFLICT DO NOTHING and every
-- delete is scoped, so a replay changes nothing.

-- --- 1. Create the SALES role for every tenant that lacks it ----------------
INSERT INTO role_definition (id, tenant_id, key, name, description, is_system, landing_path)
SELECT
  'role-' || t.id || '-sales',
  t.id,
  'SALES',
  'Sales',
  'Penerimaan dan pencatatan Customer Order, beserta status pemenuhannya. Tanpa akses planning maupun eksekusi produksi.',
  TRUE,
  '/order-receiving'
FROM tenant t
WHERE NOT EXISTS (
  SELECT 1 FROM role_definition rd WHERE rd.tenant_id = t.id AND rd.key = 'SALES'
)
ON CONFLICT (tenant_id, key) DO NOTHING;

-- --- 2. SALES permissions ---------------------------------------------------
-- Deliberately short. Sales answers "kapan order ini siap" from the order's own
-- derived status, which `customer_order:view` already carries, so there is no
-- reason to hand them Planning to get it.
INSERT INTO role_permission (role_id, permission)
SELECT rd.id, p.permission
FROM role_definition rd
CROSS JOIN (VALUES
  ('dashboard:view'),
  ('customer:view'),
  ('customer:manage'),
  ('customer_order:view'),
  ('customer_order:create'),
  ('customer_order:edit'),
  ('customer_order:cancel'),
  ('master_data:view'),
  ('report:export')
) AS p(permission)
WHERE rd.key = 'SALES'
ON CONFLICT (role_id, permission) DO NOTHING;

-- --- 3. Planning permissions for the roles that already existed -------------
DO $$
DECLARE
  grant_row RECORD;
BEGIN
  FOR grant_row IN
    SELECT * FROM (VALUES
      -- PPIC owns forecast, capacity, plan, work order and scheduling (§8.1).
      ('PPIC', 'customer:view'),
      ('PPIC', 'customer_order:view'),
      ('PPIC', 'demand_forecast:view'),
      ('PPIC', 'demand_forecast:generate'),
      ('PPIC', 'capacity_plan:view'),
      ('PPIC', 'capacity_plan:manage'),
      ('PPIC', 'production_plan:view'),
      ('PPIC', 'production_plan:create'),
      ('PPIC', 'production_plan:edit'),
      ('PPIC', 'production_plan:confirm'),

      -- Production Manager: full on Production Plan, view on the demand side.
      ('PRODUCTION_MANAGER', 'customer:view'),
      ('PRODUCTION_MANAGER', 'customer_order:view'),
      ('PRODUCTION_MANAGER', 'demand_forecast:view'),
      ('PRODUCTION_MANAGER', 'capacity_plan:view'),
      ('PRODUCTION_MANAGER', 'capacity_plan:manage'),
      ('PRODUCTION_MANAGER', 'production_plan:view'),
      ('PRODUCTION_MANAGER', 'production_plan:create'),
      ('PRODUCTION_MANAGER', 'production_plan:edit'),
      ('PRODUCTION_MANAGER', 'production_plan:confirm'),

      -- Supervisor and Quality read the plan; Capacity Planning is View for
      -- Supervisor and absent for Quality per the ACL table.
      ('SUPERVISOR', 'customer_order:view'),
      ('SUPERVISOR', 'production_plan:view'),
      ('SUPERVISOR', 'capacity_plan:view'),
      ('QUALITY', 'customer_order:view'),
      ('QUALITY', 'production_plan:view'),

      -- Executive is view-only across the board.
      ('EXECUTIVE', 'customer:view'),
      ('EXECUTIVE', 'customer_order:view'),
      ('EXECUTIVE', 'demand_forecast:view'),
      ('EXECUTIVE', 'capacity_plan:view'),
      ('EXECUTIVE', 'production_plan:view')
    ) AS g(role_key, permission)
  LOOP
    INSERT INTO role_permission (role_id, permission)
    SELECT rd.id, grant_row.permission
    FROM role_definition rd
    WHERE rd.key = grant_row.role_key AND rd.is_system = TRUE
    ON CONFLICT (role_id, permission) DO NOTHING;
  END LOOP;
END $$;

-- ADMIN holds the whole catalogue, so it takes every new permission too.
INSERT INTO role_permission (role_id, permission)
SELECT rd.id, p.permission
FROM role_definition rd
CROSS JOIN (VALUES
  ('customer:view'), ('customer:manage'),
  ('customer_order:view'), ('customer_order:create'),
  ('customer_order:edit'), ('customer_order:cancel'),
  ('demand_forecast:view'), ('demand_forecast:generate'),
  ('capacity_plan:view'), ('capacity_plan:manage'),
  ('production_plan:view'), ('production_plan:create'),
  ('production_plan:edit'), ('production_plan:confirm')
) AS p(permission)
WHERE rd.key = 'ADMIN' AND rd.is_system = TRUE
ON CONFLICT (role_id, permission) DO NOTHING;

-- --- 4. Order ownership leaves PPIC ----------------------------------------
-- PPIC plans against demand; it does not receive, edit or cancel the order that
-- carries it. Removing the permissions is the point of the role split — leaving
-- them would make SALES a label rather than a boundary.
DELETE FROM role_permission rp
USING role_definition rd
WHERE rp.role_id = rd.id
  AND rd.key = 'PPIC'
  AND rd.is_system = TRUE
  AND rp.permission IN (
    'customer:manage',
    'customer_order:create',
    'customer_order:edit',
    'customer_order:cancel'
  );
