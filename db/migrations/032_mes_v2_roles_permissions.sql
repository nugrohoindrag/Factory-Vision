-- ============================================================================
-- 032  MES Improvement v2.0 — new roles and the improvement permissions
-- ============================================================================
--
-- Same problem 017 solved, one release later: the application materialises
-- baseline roles only for a tenant that has none, which is right (§22.4 lets a
-- tenant retune a system role, and re-applying the baseline on every boot would
-- undo that) but means every permission added after a tenant was provisioned is
-- inert for that tenant. All forty-odd permissions from Improvement PRD §34
-- would be in the catalogue and granted to nobody.
--
-- Two things here, both idempotent:
--
--  1. **MAINTENANCE, WAREHOUSE and WORKFORCE_ADMIN become system roles** (§35).
--     Each owns work that was previously somebody's side duty inside Supervisor
--     or Admin, and a plant cannot say who owns a job by looking at a roster
--     that has no row for it.
--
--  2. **The improvement permissions reach the roles that already exist**,
--     transcribed from `SYSTEM_ROLE_PERMISSIONS` in
--     `apps/api/src/modules/rbac/permissions.ts`. That file stays the source of
--     truth for a fresh tenant; this is the one-off catch-up for existing ones.

-- --- 1. The three new system roles ------------------------------------------

INSERT INTO role_definition (id, tenant_id, key, name, description, is_system, landing_path)
SELECT 'role-' || t.id || '-maintenance', t.id, 'MAINTENANCE', 'Maintenance',
       'Preventive, corrective, dan emergency maintenance mesin. Tanpa akses eksekusi produksi.',
       TRUE, '/maintenance'
FROM tenant t
WHERE NOT EXISTS (SELECT 1 FROM role_definition rd WHERE rd.tenant_id = t.id AND rd.key = 'MAINTENANCE')
ON CONFLICT (tenant_id, key) DO NOTHING;

INSERT INTO role_definition (id, tenant_id, key, name, description, is_system, landing_path)
SELECT 'role-' || t.id || '-warehouse', t.id, 'WAREHOUSE', 'Warehouse',
       'Inventory, issue, return, dan penyesuaian stok material beserta ledger transaksinya.',
       TRUE, '/material-inventory'
FROM tenant t
WHERE NOT EXISTS (SELECT 1 FROM role_definition rd WHERE rd.tenant_id = t.id AND rd.key = 'WAREHOUSE')
ON CONFLICT (tenant_id, key) DO NOTHING;

INSERT INTO role_definition (id, tenant_id, key, name, description, is_system, landing_path)
SELECT 'role-' || t.id || '-workforce-admin', t.id, 'WORKFORCE_ADMIN', 'Workforce Admin',
       'Skill, kualifikasi, penugasan shift, dan ketersediaan operator. Tanpa akses eksekusi produksi.',
       TRUE, '/workforce'
FROM tenant t
WHERE NOT EXISTS (SELECT 1 FROM role_definition rd WHERE rd.tenant_id = t.id AND rd.key = 'WORKFORCE_ADMIN')
ON CONFLICT (tenant_id, key) DO NOTHING;

-- --- 2. Permissions per role ------------------------------------------------

DO $$
DECLARE
  grant_row RECORD;
BEGIN
  FOR grant_row IN
    SELECT * FROM (VALUES
      -- Executive: view-only across every new module, as everywhere else.
      ('EXECUTIVE', 'material:view'),
      ('EXECUTIVE', 'mrp:view'),
      ('EXECUTIVE', 'quality:view'),
      ('EXECUTIVE', 'maintenance:view'),
      ('EXECUTIVE', 'workforce:view'),
      ('EXECUTIVE', 'wip:view'),
      ('EXECUTIVE', 'production_board:view'),
      ('EXECUTIVE', 'event:view'),

      -- Production Manager (§35): production, WIP, labour, quality performance
      -- and maintenance impact. Execution of quality and maintenance work
      -- belongs to those roles; visibility and disposition do not.
      ('PRODUCTION_MANAGER', 'material:view'),
      ('PRODUCTION_MANAGER', 'material:reserve'),
      ('PRODUCTION_MANAGER', 'mrp:view'),
      ('PRODUCTION_MANAGER', 'mrp:run'),
      ('PRODUCTION_MANAGER', 'mrp:approve'),
      ('PRODUCTION_MANAGER', 'quality:view'),
      ('PRODUCTION_MANAGER', 'quality:hold'),
      ('PRODUCTION_MANAGER', 'quality:disposition'),
      ('PRODUCTION_MANAGER', 'ncr:create'),
      ('PRODUCTION_MANAGER', 'ncr:manage'),
      ('PRODUCTION_MANAGER', 'maintenance:view'),
      ('PRODUCTION_MANAGER', 'maintenance:create'),
      ('PRODUCTION_MANAGER', 'workforce:view'),
      ('PRODUCTION_MANAGER', 'workforce:assignment'),
      ('PRODUCTION_MANAGER', 'wip:view'),
      ('PRODUCTION_MANAGER', 'wip:hold'),
      ('PRODUCTION_MANAGER', 'wip:release'),
      ('PRODUCTION_MANAGER', 'production_board:view'),
      ('PRODUCTION_MANAGER', 'production_board:reschedule'),
      ('PRODUCTION_MANAGER', 'production_board:assign'),
      ('PRODUCTION_MANAGER', 'production_board:dispatch'),
      ('PRODUCTION_MANAGER', 'event:view'),

      -- Supervisor: dispatch, operator assignment, WIP and quality on the floor.
      ('SUPERVISOR', 'material:view'),
      ('SUPERVISOR', 'material:reserve'),
      ('SUPERVISOR', 'material:consume'),
      ('SUPERVISOR', 'material:return'),
      ('SUPERVISOR', 'quality:view'),
      ('SUPERVISOR', 'quality:inspect'),
      ('SUPERVISOR', 'quality:hold'),
      ('SUPERVISOR', 'ncr:create'),
      ('SUPERVISOR', 'maintenance:view'),
      ('SUPERVISOR', 'maintenance:create'),
      ('SUPERVISOR', 'workforce:view'),
      ('SUPERVISOR', 'workforce:assignment'),
      ('SUPERVISOR', 'workforce:availability'),
      ('SUPERVISOR', 'wip:view'),
      ('SUPERVISOR', 'wip:create'),
      ('SUPERVISOR', 'wip:transfer'),
      ('SUPERVISOR', 'wip:receive'),
      ('SUPERVISOR', 'wip:hold'),
      ('SUPERVISOR', 'production_board:view'),
      ('SUPERVISOR', 'production_board:reschedule'),
      ('SUPERVISOR', 'production_board:assign'),
      ('SUPERVISOR', 'production_board:dispatch'),
      ('SUPERVISOR', 'event:view'),

      -- Operator: consume material, inspect where assigned, move WIP on. No
      -- board, no MRP, no workforce administration.
      ('OPERATOR', 'material:view'),
      ('OPERATOR', 'material:consume'),
      ('OPERATOR', 'material:return'),
      ('OPERATOR', 'quality:view'),
      ('OPERATOR', 'quality:inspect'),
      ('OPERATOR', 'maintenance:create'),
      ('OPERATOR', 'wip:view'),
      ('OPERATOR', 'wip:create'),
      ('OPERATOR', 'wip:transfer'),
      ('OPERATOR', 'wip:receive'),

      -- PPIC: MRP and material readiness are its primary responsibility (§35),
      -- and the board is where the plan becomes a dispatch.
      ('PPIC', 'material:view'),
      ('PPIC', 'material:reserve'),
      ('PPIC', 'mrp:view'),
      ('PPIC', 'mrp:run'),
      ('PPIC', 'quality:view'),
      ('PPIC', 'maintenance:view'),
      ('PPIC', 'workforce:view'),
      ('PPIC', 'wip:view'),
      ('PPIC', 'production_board:view'),
      ('PPIC', 'production_board:reschedule'),
      ('PPIC', 'production_board:assign'),
      ('PPIC', 'event:view'),

      -- Quality owns the whole lifecycle, plus the WIP hold/release pair — a
      -- quality gate that cannot stop a transfer is not a gate (BR-H04).
      ('QUALITY', 'quality:view'),
      ('QUALITY', 'quality:inspect'),
      ('QUALITY', 'quality:hold'),
      ('QUALITY', 'quality:release'),
      ('QUALITY', 'quality:disposition'),
      ('QUALITY', 'ncr:create'),
      ('QUALITY', 'ncr:manage'),
      ('QUALITY', 'material:view'),
      ('QUALITY', 'wip:view'),
      ('QUALITY', 'wip:hold'),
      ('QUALITY', 'wip:release'),
      ('QUALITY', 'event:view'),

      -- Maintenance: machine health, and read access to what is scheduled on a
      -- machine before taking it offline (BR-MT04).
      ('MAINTENANCE', 'dashboard:view'),
      ('MAINTENANCE', 'work_order:view'),
      ('MAINTENANCE', 'production_board:view'),
      ('MAINTENANCE', 'analytics:view'),
      ('MAINTENANCE', 'report:export'),
      ('MAINTENANCE', 'master_data:view'),
      ('MAINTENANCE', 'shift:view'),
      ('MAINTENANCE', 'downtime:create'),
      ('MAINTENANCE', 'maintenance:view'),
      ('MAINTENANCE', 'maintenance:create'),
      ('MAINTENANCE', 'maintenance:assign'),
      ('MAINTENANCE', 'maintenance:execute'),
      ('MAINTENANCE', 'maintenance:complete'),
      ('MAINTENANCE', 'event:view'),

      -- Warehouse: stock, issue, return and the ledger. `material:adjust` is
      -- privileged and lands here because a stock take is this role's job.
      ('WAREHOUSE', 'dashboard:view'),
      ('WAREHOUSE', 'work_order:view'),
      ('WAREHOUSE', 'master_data:view'),
      ('WAREHOUSE', 'report:export'),
      ('WAREHOUSE', 'material:view'),
      ('WAREHOUSE', 'material:reserve'),
      ('WAREHOUSE', 'material:consume'),
      ('WAREHOUSE', 'material:return'),
      ('WAREHOUSE', 'material:adjust'),
      ('WAREHOUSE', 'mrp:view'),
      ('WAREHOUSE', 'wip:view'),
      ('WAREHOUSE', 'event:view'),

      -- Workforce admin: who is qualified, on which shift, and present. No
      -- production write at all.
      ('WORKFORCE_ADMIN', 'dashboard:view'),
      ('WORKFORCE_ADMIN', 'master_data:view'),
      ('WORKFORCE_ADMIN', 'report:export'),
      ('WORKFORCE_ADMIN', 'shift:view'),
      ('WORKFORCE_ADMIN', 'analytics:view'),
      ('WORKFORCE_ADMIN', 'workforce:view'),
      ('WORKFORCE_ADMIN', 'workforce:manage'),
      ('WORKFORCE_ADMIN', 'workforce:qualification'),
      ('WORKFORCE_ADMIN', 'workforce:assignment'),
      ('WORKFORCE_ADMIN', 'workforce:availability'),
      ('WORKFORCE_ADMIN', 'event:view')
    ) AS g(role_key, permission)
  LOOP
    INSERT INTO role_permission (role_id, permission)
    SELECT rd.id, grant_row.permission
    FROM role_definition rd
    WHERE rd.key = grant_row.role_key AND rd.is_system = TRUE
    ON CONFLICT (role_id, permission) DO NOTHING;
  END LOOP;
END $$;

-- --- 3. ADMIN holds the whole catalogue -------------------------------------

INSERT INTO role_permission (role_id, permission)
SELECT rd.id, p.permission
FROM role_definition rd
CROSS JOIN (VALUES
  ('material:view'), ('material:reserve'), ('material:consume'), ('material:return'),
  ('material:adjust'),
  ('mrp:view'), ('mrp:run'), ('mrp:approve'),
  ('quality:view'), ('quality:inspect'), ('quality:hold'), ('quality:release'),
  ('quality:disposition'), ('ncr:create'), ('ncr:manage'),
  ('maintenance:view'), ('maintenance:create'), ('maintenance:assign'),
  ('maintenance:execute'), ('maintenance:complete'),
  ('workforce:view'), ('workforce:manage'), ('workforce:qualification'),
  ('workforce:assignment'), ('workforce:availability'),
  ('wip:view'), ('wip:create'), ('wip:transfer'), ('wip:receive'), ('wip:hold'), ('wip:release'),
  ('production_board:view'), ('production_board:reschedule'), ('production_board:assign'),
  ('production_board:dispatch'),
  ('event:view')
) AS p(permission)
WHERE rd.key = 'ADMIN' AND rd.is_system = TRUE
ON CONFLICT (role_id, permission) DO NOTHING;
