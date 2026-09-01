-- Rollback 018. Removing the permission re-opens the hole it closed, so it is
-- withdrawn only from the roles this migration granted it to; the route rule in
-- code is what actually enforces the gate.
DELETE FROM role_permission rp USING role_definition rd
 WHERE rp.role_id = rd.id
   AND rd.is_system = TRUE
   AND rp.permission = 'work_order:confirm';
