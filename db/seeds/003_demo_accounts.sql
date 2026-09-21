-- Demo accounts for the pilot tenant, one per system role plus the three
-- seeded operators.
--
-- This is demo data, applied only when SEED_DEMO_DATA=true, and the
-- passwords are published beside the emails on purpose so a demo can be
-- walked from any role without an administrator issuing accounts first:
--
--   admin@factoryvision.id         ADMIN               Admin#FV2026!
--   executive@factoryvision.id     EXECUTIVE           Executive#FV2026
--   manager@factoryvision.id       PRODUCTION_MANAGER  Manager#FV2026
--   supervisor@factoryvision.id    SUPERVISOR          Supervisor#FV2026
--   ppic@factoryvision.id          PPIC                PPIC#FV2026!
--   quality@factoryvision.id       QUALITY             Quality#FV2026
--   maintenance@factoryvision.id   MAINTENANCE         Maintenance#FV2026
--   warehouse@factoryvision.id     WAREHOUSE           Warehouse#FV2026
--   workforce@factoryvision.id     WORKFORCE_ADMIN     Workforce#FV2026
--   sales@factoryvision.id         SALES               Sales#FV2026!
--
--   budi.santoso@factoryvision.id    OP-1001  Operator#FV2026   (terminal)
--   siti.rahmawati@factoryvision.id  OP-1002  Operator#FV2026   (terminal)
--   agus.prasetyo@factoryvision.id   OP-1003  Operator#FV2026   (terminal)
--
-- A real plant must never run with this seed on: BOOTSTRAP_ADMIN_* is the
-- only credential a production install ships with.
--
-- Idempotent on a populated database: an account is only inserted when no
-- account in the tenant already uses the email, so a password an
-- administrator has since changed is never reset by a replay. The operators
-- receive an email and a password only while they still have none.

INSERT INTO app_user (id, tenant_id, email, password_hash, name, role, account_type, scope_level, status)
SELECT v.id, 'tenant-pilot-factory-01', v.email, v.password_hash, v.name, v.role, 'APPLICATION_USER', 'TENANT', 'ACTIVE'
FROM (VALUES
  ('usr-demo-admin',       'admin@factoryvision.id',       'scrypt$e151c3db33e0777fc2b40d20ec618849$b21e11d5cda618ebcbc2c26b01091174a29017b79f9fa23d8a4772c534e3c12a22336b8c5e1c0bdeaadade73982f0172e5806c2009690c84ff797f2ce7d29a1b', 'Administrator',        'ADMIN'),
  ('usr-demo-executive',   'executive@factoryvision.id',   'scrypt$cac792333206312f70b7cf356927c94c$e88963ea712018f4fd9bec6a6c645ede9676ba8b5c213bdefa3419df3f4793ad019ea39a2f8f9a78d3593d3844c16678f76bdab899601c02028986bc884f718a', 'Direktur Operasional', 'EXECUTIVE'),
  ('usr-demo-manager',     'manager@factoryvision.id',     'scrypt$9775c9553cdbc133c7e75226867ba73e$87764b33a9925e15b9278b3858856175fa587a1eca6990b18242c14107dc2c77182d52f4dc3ec270a09fd049f5e5a8b6df811997a96495ea910622270d3fed17', 'Manajer Produksi',     'PRODUCTION_MANAGER'),
  ('usr-demo-supervisor',  'supervisor@factoryvision.id',  'scrypt$3433cdff7672cccf430600436da65be7$9b2d80452feda41c611071720e82ec43c1a1cf890bae89cc0200628f56a5390298ddd7bc06ecd128b171a27afb996093a2918d9f65cd86edc6195403e9733910', 'Supervisor Produksi',  'SUPERVISOR'),
  ('usr-demo-ppic',        'ppic@factoryvision.id',        'scrypt$73b6aed070107381346cbd2e9c69f371$d902690cfebe20056b3ea2eb2d6c552a7d1258de089dd83bf41ee6a660da4f3248f4fb513ea3f2e9f9cdfb8b5d456a3ba74eb7ea981239113d9c50c0862a640b', 'Staf PPIC',            'PPIC'),
  ('usr-demo-quality',     'quality@factoryvision.id',     'scrypt$8058c8322bfe14ae0174c44ac3661fe6$0a165b254219d1d9556a4ba3bf3067be74d54a3edb16cafee76ac46b42d22afa49b1e553c18bdb0c25453ebcf2afc9ca5d7cae3513c3f3ecef814e9cbac53292', 'Inspektur QC',         'QUALITY'),
  ('usr-demo-maintenance', 'maintenance@factoryvision.id', 'scrypt$6c13ca9b42a1cf8c5f969f87b3bac400$4fb67284dc309c8240a73570201047ed95de0fc26a2a33fec58dd0c709d6aee81ed58b6a4057fea775e853187cfe53e676e1c3c3b676f645ebefd571621535bd', 'Teknisi Maintenance',  'MAINTENANCE'),
  ('usr-demo-warehouse',   'warehouse@factoryvision.id',   'scrypt$e6e4e4aecbb50a25569360beebc3f32c$b88f6d7052d182160f499c2cda585c37cf0fb91bc2018516842882586cd83aa90a00dc704ee71ae02a168c25dceb6eaf47b50ec7d68db2323b6d3b47e03d49fe', 'Staf Gudang',          'WAREHOUSE'),
  ('usr-demo-workforce',   'workforce@factoryvision.id',   'scrypt$3fbd2915ebd22edc08494def43625b9d$aa457e96d5de6ba1cbab15538f49982cb89503693c639839c3038ee8e7c93572d0ddd1f4b41e8ef62b3a04e35fa0005e6dfefe4d581c75425b99de85d578e422', 'Admin Tenaga Kerja',   'WORKFORCE_ADMIN'),
  ('usr-demo-sales',       'sales@factoryvision.id',       'scrypt$4fe97db7ae14a448af84d791fe184615$5ee9d1655c22eddd649129bc13c12ede082ff76f31b0ffd6a39287fe4e1f861702b9b89212b4be83ac22ea2618aac98bab4c7c604a5ec4e85d3de7635874a160', 'Staf Sales',           'SALES')
) AS v(id, email, password_hash, name, role)
WHERE NOT EXISTS (
  SELECT 1 FROM app_user u
  WHERE u.tenant_id = 'tenant-pilot-factory-01' AND (u.id = v.id OR lower(u.email) = lower(v.email))
);

-- Operators sign in on the terminal with these. The hash is written only
-- where none exists, so an operator who has already been given a password
-- keeps it.
UPDATE operator AS o
SET email = v.email,
    password_hash = COALESCE(o.password_hash, v.password_hash)
FROM (VALUES
  ('op-001', 'budi.santoso@factoryvision.id',   'scrypt$b967b548fffc001fa00bde2361e48153$3904ac255893edd2272321b58dfb70eebf7196d0030b1310a805621fd19bfbd5f7564210de1be6ce78a96a1b2a8484989ebc416b09955f0a6384378161879003'),
  ('op-002', 'siti.rahmawati@factoryvision.id', 'scrypt$b967b548fffc001fa00bde2361e48153$3904ac255893edd2272321b58dfb70eebf7196d0030b1310a805621fd19bfbd5f7564210de1be6ce78a96a1b2a8484989ebc416b09955f0a6384378161879003'),
  ('op-003', 'agus.prasetyo@factoryvision.id',  'scrypt$b967b548fffc001fa00bde2361e48153$3904ac255893edd2272321b58dfb70eebf7196d0030b1310a805621fd19bfbd5f7564210de1be6ce78a96a1b2a8484989ebc416b09955f0a6384378161879003')
) AS v(id, email, password_hash)
WHERE o.id = v.id
  AND o.tenant_id = 'tenant-pilot-factory-01'
  AND o.email IS NULL;
