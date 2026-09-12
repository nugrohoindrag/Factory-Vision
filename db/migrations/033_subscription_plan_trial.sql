-- ============================================================================
-- 033  The trial plan that self-serve registration has referenced all along
-- ============================================================================
--
-- `OnboardingService.registerTrial` opens every new account with
--
--     INSERT INTO client_subscription (…, plan_id, …) VALUES (…, 'plan-trial', …)
--
-- and `client_subscription.plan_id` is a foreign key to `subscription_plan`.
-- 003 seeded three sellable tiers and nothing else, so the insert failed on
-- every database that had ever run the migrations, the transaction rolled the
-- tenant back with it, and the public form answered 422 "Data yang
-- direferensikan tidak ditemukan." — for a request that was entirely valid.
-- It went unnoticed because the only automated check of the endpoint stops at
-- the password policy, before the database is touched.
--
-- The trial is deliberately a *plan* rather than a nullable plan_id: the
-- product's limit checks read ceilings from the plan row, and a 14-day
-- evaluation should run into the same walls as the tier it converts into.
-- Plant-tier ceilings, no price. `code` is unique, so this is a no-op on
-- every replay.

INSERT INTO subscription_plan
  (id, code, name, description,
   max_plants, max_production_lines, max_machines, max_users, max_operators, monthly_price_idr)
VALUES
  ('plan-trial', 'TRIAL', 'Trial 14 Hari',
   'Evaluasi gratis 14 hari dengan batas setara paket Plant. Berakhir sendiri; tidak ditagih.',
   1, 10, 80, 50, 200, 0)
ON CONFLICT (code) DO NOTHING;
