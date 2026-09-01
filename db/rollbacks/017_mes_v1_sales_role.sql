-- ============================================================================
-- Rollback 017  SALES role
-- ============================================================================
-- Returns order ownership to PPIC before removing SALES, so no tenant is left
-- with nobody able to receive an order.

INSERT INTO role_permission (role_id, permission)
SELECT rd.id, p.permission
FROM role_definition rd
CROSS JOIN (VALUES
  ('customer:manage'),
  ('customer_order:create'),
  ('customer_order:edit'),
  ('customer_order:cancel')
) AS p(permission)
WHERE rd.key = 'PPIC' AND rd.is_system = TRUE
ON CONFLICT (role_id, permission) DO NOTHING;

-- Users holding the role would be left pointing at a role that is gone, so the
-- rollback refuses rather than orphaning them.
DO $$
DECLARE
  holders INT;
BEGIN
  SELECT COUNT(*) INTO holders FROM app_user WHERE role = 'SALES';
  IF holders > 0 THEN
    RAISE EXCEPTION
      'Rollback 017 dibatalkan: % pengguna masih berperan SALES. Pindahkan mereka ke peran lain lebih dahulu.',
      holders;
  END IF;
END $$;

DELETE FROM role_permission rp USING role_definition rd
 WHERE rp.role_id = rd.id AND rd.key = 'SALES';
DELETE FROM role_definition WHERE key = 'SALES';
