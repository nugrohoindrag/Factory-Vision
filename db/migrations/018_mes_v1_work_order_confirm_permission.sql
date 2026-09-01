-- ============================================================================
-- 018  work_order:confirm — closing an authorization hole
-- ============================================================================
-- `POST /api/v1/work-orders/:id/confirm` had no row in the route→permission
-- table. `authorizeRoutes` falls back to `dashboard:view` for an unmapped
-- route, which meant **every signed-in role that can open a dashboard could
-- confirm a Work Order** — and confirmation is the gate that puts it on the
-- operator terminal (§25.7).
--
-- Root cause: ADR-18 replaced RELEASED with CONFIRMED and added the endpoint,
-- but the table kept only the `/release` rule. Two mistakes cancelled out —
-- PPIC, which the ACL gives Full on Work Order Confirmation, was refused by
-- `/release` yet allowed through the unguarded `/confirm`.
--
-- The code now maps both endpoints to `work_order:confirm`. This grants it to
-- the roles §22.4 gives Work Order Confirmation: Production Manager,
-- Supervisor, PPIC and Admin. Executive, Operator, Quality and Sales get
-- nothing, which is what the ACL says.

INSERT INTO role_permission (role_id, permission)
SELECT rd.id, 'work_order:confirm'
FROM role_definition rd
WHERE rd.is_system = TRUE
  AND rd.key IN ('PRODUCTION_MANAGER', 'SUPERVISOR', 'PPIC', 'ADMIN')
ON CONFLICT (role_id, permission) DO NOTHING;
