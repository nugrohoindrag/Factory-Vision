-- Factory Vision - Complete Initial Seed Data
-- Pilot Tire Factory Demo Dataset (PRD §37 & Technical Architecture §24)

-- 1. Tenant
INSERT INTO tenant (id, name, timezone, plan, status)
VALUES ('tenant-pilot-factory-01', 'PT Nusantara Tire Precision', 'Asia/Jakarta', 'MID_MARKET', 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

-- 2. Plant
INSERT INTO plant (id, tenant_id, name, location, timezone, status)
VALUES ('plant-cikarang-01', 'tenant-pilot-factory-01', 'Pabrik Utama Cikarang (Demo Tire Plant)', 'Kawasan Industri GIIC Cikarang Blok C-12, Jawa Barat', 'Asia/Jakarta', 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

-- 3. Production Processes (PRD §23, §37.3)
INSERT INTO production_process (id, tenant_id, code, name, description, sequence_default, status)
VALUES
  ('proc-mixing', 'tenant-pilot-factory-01', 'MIX', 'Mixing & Compounding', 'Pencampuran karet alam, sintetis, dan bahan kimia Banbury', 1, 'ACTIVE'),
  ('proc-calendering', 'tenant-pilot-factory-01', 'CAL', 'Fabric & Steel Calendering', 'Pelapisan kawat baja dan serat nilon dengan kompon karet', 2, 'ACTIVE'),
  ('proc-extrusion', 'tenant-pilot-factory-01', 'EXT', 'Extrusion (Tread & Sidewall)', 'Ekstrusi profil tapak dan dinding samping ban', 3, 'ACTIVE'),
  ('proc-cutting', 'tenant-pilot-factory-01', 'CUT', 'Component Cutting', 'Pemotongan ply cord dan steel belt sesuai spesifikasi', 4, 'ACTIVE'),
  ('proc-bead', 'tenant-pilot-factory-01', 'BWD', 'Bead Manufacturing', 'Pembuatan kawat ring pengunci velg (bead core)', 5, 'ACTIVE'),
  ('proc-building', 'tenant-pilot-factory-01', 'TBM', 'Tire Building (TBM)', 'Perakitan komponen menjadi ban mentah (Green Tire)', 6, 'ACTIVE'),
  ('proc-curing', 'tenant-pilot-factory-01', 'CPR', 'Curing / Vulcanizing', 'Pemasakan ban dengan panas dan tekanan dalam cetakan (Curing Press)', 7, 'ACTIVE'),
  ('proc-finishing', 'tenant-pilot-factory-01', 'FIN', 'Finishing & Trimming', 'Pembersihan flash dan sisa cetakan vulkanisasi', 8, 'ACTIVE'),
  ('proc-inspection', 'tenant-pilot-factory-01', 'INS', 'Quality & Uniformity Inspection', 'Pemeriksaan visual, X-ray, dan balance test ban jadi', 9, 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

-- 4. Production Lines
INSERT INTO production_line (id, tenant_id, plant_id, code, name, status, planned_production_time_minutes)
VALUES 
  ('line-01', 'tenant-pilot-factory-01', 'plant-cikarang-01', 'LINE-ALPHA', 'Line Tire Production Alpha (Passenger Car)', 'ACTIVE', 480),
  ('line-02', 'tenant-pilot-factory-01', 'plant-cikarang-01', 'LINE-BETA', 'Line Tire Production Beta (SUV & Light Truck)', 'ACTIVE', 480)
ON CONFLICT (id) DO NOTHING;

-- 5. Work Centers
INSERT INTO work_center (id, tenant_id, production_line_id, code, name, sequence)
VALUES
  ('wc-mixing', 'tenant-pilot-factory-01', 'line-01', 'WC-MIX', 'Mixing Area Banbury', 1),
  ('wc-extrusion', 'tenant-pilot-factory-01', 'line-01', 'WC-EXT', 'Extruder Tread Area', 2),
  ('wc-calendering', 'tenant-pilot-factory-01', 'line-01', 'WC-CAL', 'Calender Steel Area', 3),
  ('wc-building', 'tenant-pilot-factory-01', 'line-01', 'WC-TBM', 'Tire Building Machine Bay', 4),
  ('wc-curing', 'tenant-pilot-factory-01', 'line-01', 'WC-CPR', 'Curing Press Vulcanizing Area', 5),
  ('wc-inspection', 'tenant-pilot-factory-01', 'line-01', 'WC-INS', 'Final Inspection Station', 6)
ON CONFLICT (id) DO NOTHING;

-- 6. Machines (PRD §37.3)
INSERT INTO machine (id, tenant_id, work_center_id, code, name, status, ideal_cycle_time_seconds, current_state)
VALUES
  ('mc-mix-01', 'tenant-pilot-factory-01', 'wc-mixing', 'MIX-001', 'Banbury Internal Mixer 01', 'ACTIVE', 90.0, 'RUNNING'),
  ('mc-mix-02', 'tenant-pilot-factory-01', 'wc-mixing', 'MIX-002', 'Banbury Internal Mixer 02', 'ACTIVE', 90.0, 'IDLE'),
  ('mc-ext-01', 'tenant-pilot-factory-01', 'wc-extrusion', 'EXT-001', 'Triplex Tread Extruder 01', 'ACTIVE', 45.0, 'RUNNING'),
  ('mc-cal-01', 'tenant-pilot-factory-01', 'wc-calendering', 'CAL-001', '4-Roll Steel Cord Calender 01', 'ACTIVE', 60.0, 'RUNNING'),
  ('mc-tbm-01', 'tenant-pilot-factory-01', 'wc-building', 'TBM-001', 'Tire Building Machine Alpha 01', 'ACTIVE', 150.0, 'RUNNING'),
  ('mc-tbm-02', 'tenant-pilot-factory-01', 'wc-building', 'TBM-002', 'Tire Building Machine Alpha 02', 'ACTIVE', 180.0, 'RUNNING'),
  ('mc-cpr-01', 'tenant-pilot-factory-01', 'wc-curing', 'CPR-001', 'Dual Cavity Curing Press 01', 'ACTIVE', 750.0, 'RUNNING'),
  ('mc-cpr-02', 'tenant-pilot-factory-01', 'wc-curing', 'CPR-002', 'Dual Cavity Curing Press 02', 'ACTIVE', 900.0, 'DOWNTIME'),
  ('mc-ins-01', 'tenant-pilot-factory-01', 'wc-inspection', 'INS-001', 'X-Ray & Uniformity Tester 01', 'ACTIVE', 30.0, 'RUNNING')
ON CONFLICT (id) DO NOTHING;

-- 7. Products (PRD §37.7)
INSERT INTO product (id, tenant_id, sku, name, unit, ideal_cycle_time_seconds, status)
VALUES
  ('prod-tire-a', 'tenant-pilot-factory-01', 'TIRE-PCR-185', 'Tire A: Passenger Car Radial 185/65 R15', 'PCS', 150.0, 'ACTIVE'),
  ('prod-tire-b', 'tenant-pilot-factory-01', 'TIRE-SUV-235', 'Tire B: SUV All-Terrain 235/70 R16', 'PCS', 180.0, 'ACTIVE'),
  ('prod-tire-c', 'tenant-pilot-factory-01', 'TIRE-LTR-195', 'Tire C: Light Truck Commercial 195 R14C', 'PCS', 210.0, 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

-- 8. Product Machine Rates (PRD §37.5)
INSERT INTO product_machine_rate (id, tenant_id, product_id, machine_id, ideal_cycle_time_seconds)
VALUES
  ('pmr-a-tbm1', 'tenant-pilot-factory-01', 'prod-tire-a', 'mc-tbm-01', 150.0),
  ('pmr-a-cpr1', 'tenant-pilot-factory-01', 'prod-tire-a', 'mc-cpr-01', 750.0),
  ('pmr-b-tbm1', 'tenant-pilot-factory-01', 'prod-tire-b', 'mc-tbm-01', 180.0),
  ('pmr-b-cpr1', 'tenant-pilot-factory-01', 'prod-tire-b', 'mc-cpr-01', 900.0),
  ('pmr-c-tbm2', 'tenant-pilot-factory-01', 'prod-tire-c', 'mc-tbm-02', 210.0),
  ('pmr-c-cpr2', 'tenant-pilot-factory-01', 'prod-tire-c', 'mc-cpr-02', 1050.0)
ON CONFLICT (id) DO NOTHING;

-- 9. Product Routings (PRD §37.2)
INSERT INTO product_routing (id, tenant_id, product_id, process_id, sequence, work_center_id, machine_id, standard_cycle_time_seconds, active)
VALUES
  ('rt-a-1', 'tenant-pilot-factory-01', 'prod-tire-a', 'proc-mixing', 1, 'wc-mixing', 'mc-mix-01', 90.0, true),
  ('rt-a-2', 'tenant-pilot-factory-01', 'prod-tire-a', 'proc-extrusion', 2, 'wc-extrusion', 'mc-ext-01', 45.0, true),
  ('rt-a-3', 'tenant-pilot-factory-01', 'prod-tire-a', 'proc-building', 3, 'wc-building', 'mc-tbm-01', 150.0, true),
  ('rt-a-4', 'tenant-pilot-factory-01', 'prod-tire-a', 'proc-curing', 4, 'wc-curing', 'mc-cpr-01', 750.0, true),
  ('rt-a-5', 'tenant-pilot-factory-01', 'prod-tire-a', 'proc-inspection', 5, 'wc-inspection', 'mc-ins-01', 30.0, true),

  ('rt-b-1', 'tenant-pilot-factory-01', 'prod-tire-b', 'proc-mixing', 1, 'wc-mixing', 'mc-mix-01', 100.0, true),
  ('rt-b-2', 'tenant-pilot-factory-01', 'prod-tire-b', 'proc-calendering', 2, 'wc-calendering', 'mc-cal-01', 60.0, true),
  ('rt-b-3', 'tenant-pilot-factory-01', 'prod-tire-b', 'proc-building', 3, 'wc-building', 'mc-tbm-01', 180.0, true),
  ('rt-b-4', 'tenant-pilot-factory-01', 'prod-tire-b', 'proc-curing', 4, 'wc-curing', 'mc-cpr-01', 900.0, true),
  ('rt-b-5', 'tenant-pilot-factory-01', 'prod-tire-b', 'proc-inspection', 5, 'wc-inspection', 'mc-ins-01', 35.0, true)
ON CONFLICT (id) DO NOTHING;

-- 10. Shifts
INSERT INTO shift (id, tenant_id, plant_id, name, start_time, end_time, break_minutes, crosses_midnight, active)
VALUES
  ('shift-1', 'tenant-pilot-factory-01', 'plant-cikarang-01', 'Shift 1 (Pagi)', '06:00', '14:00', 60, false, true),
  ('shift-2', 'tenant-pilot-factory-01', 'plant-cikarang-01', 'Shift 2 (Sore)', '14:00', '22:00', 60, false, true),
  ('shift-3', 'tenant-pilot-factory-01', 'plant-cikarang-01', 'Shift 3 (Malam)', '22:00', '06:00', 60, true, true)
ON CONFLICT (id) DO NOTHING;

-- 11. Downtime Reasons (PRD §11, §36.4)
INSERT INTO downtime_reason (id, tenant_id, parent_id, category, code, name, description, is_planned, active, sort_order)
VALUES
  ('dt-breakdown', 'tenant-pilot-factory-01', null, 'MACHINE', 'MC-BRK', 'Kerusakan Mekanikal / Mesin Breakdown', 'Kerusakan komponen mesin hidrolik/motor', false, true, 1),
  ('dt-material', 'tenant-pilot-factory-01', null, 'MATERIAL', 'MAT-SHT', 'Kekurangan / Keterlambatan Pasokan Material', 'Karet kompon atau ply cord belum siap', false, true, 2),
  ('dt-setup', 'tenant-pilot-factory-01', null, 'PROCESS', 'PRC-STP', 'Setup & Changeover Mold / Cetakan', 'Penggantian ukuran mold cetakan ban', true, true, 3),
  ('dt-cleaning', 'tenant-pilot-factory-01', null, 'PROCESS', 'PRC-CLN', 'Pembersihan & Perawatan Harian (Cleaning)', 'Cleaning sisa karet dan pelumasan mold', true, true, 4),
  ('dt-qc-wait', 'tenant-pilot-factory-01', null, 'QUALITY', 'QLT-WQC', 'Menunggu Persetujuan / Inspeksi QC', 'Menunggu first piece inspection approval', false, true, 5),
  ('dt-operator', 'tenant-pilot-factory-01', null, 'PEOPLE', 'PPL-ABS', 'Operator Tidak Tersedia / Istirahat Bergilir', 'Kekurangan manpower di pos perakitan', false, true, 6)
ON CONFLICT (id) DO NOTHING;

-- 12. Reject Reasons (PRD §20, §36.5)
INSERT INTO reject_reason (id, tenant_id, parent_id, category, code, name, description, active, sort_order)
VALUES
  ('rej-dimension', 'tenant-pilot-factory-01', null, 'DIMENSION', 'DIM-OOS', 'Dimensi / Ketebalan Sidewall Di Luar Toleransi', 'Toleransi ketebalan dinding samping melebihi limit', true, 1),
  ('rej-blister', 'tenant-pilot-factory-01', null, 'APPEARANCE', 'APP-BLS', 'Blister / Gelembung Udara Terperangkap (Air Trap)', 'Udara terperangkap di bawah lapisan tapak/sidewall', true, 2),
  ('rej-scratch', 'tenant-pilot-factory-01', null, 'APPEARANCE', 'APP-SCR', 'Goresan / Cacat Permukaan Green Tire', 'Cacat gores saat transfer atau penyimpanan', true, 3),
  ('rej-flash', 'tenant-pilot-factory-01', null, 'MATERIAL', 'MAT-FLS', 'Excess Flash / Cacat Mold Overflow', 'Karet meluap pada garis cetakan curing press', true, 4),
  ('rej-distortion', 'tenant-pilot-factory-01', null, 'FUNCTION', 'FNC-DST', 'Tread Distortion / Keselarasan Tapak Miring', 'Tapak ban tidak simetris terhadap centerline', true, 5),
  ('rej-other', 'tenant-pilot-factory-01', null, 'OTHER', 'OTH-GEN', 'Cacat Kualitas Lainnya', 'Kondisi reject non-standar lainnya', true, 6)
ON CONFLICT (id) DO NOTHING;

-- 13. KPI Targets (PRD §13.2)
INSERT INTO kpi_target (id, tenant_id, metric, target_value, unit, direction, watch_threshold_pct, critical_threshold_pct)
VALUES
  ('tgt-oee', 'tenant-pilot-factory-01', 'OEE', 85.0, '%', 'HIGHER_IS_BETTER', 95.0, 90.0),
  ('tgt-avail', 'tenant-pilot-factory-01', 'AVAILABILITY', 90.0, '%', 'HIGHER_IS_BETTER', 95.0, 90.0),
  ('tgt-perf', 'tenant-pilot-factory-01', 'PERFORMANCE', 95.0, '%', 'HIGHER_IS_BETTER', 95.0, 90.0),
  ('tgt-qual', 'tenant-pilot-factory-01', 'QUALITY', 99.0, '%', 'HIGHER_IS_BETTER', 98.0, 95.0),
  ('tgt-achv', 'tenant-pilot-factory-01', 'PRODUCTION_ACHIEVEMENT', 100.0, '%', 'HIGHER_IS_BETTER', 95.0, 90.0),
  ('tgt-rej', 'tenant-pilot-factory-01', 'REJECT_RATE', 1.5, '%', 'LOWER_IS_BETTER', 110.0, 130.0),
  ('tgt-dt', 'tenant-pilot-factory-01', 'DOWNTIME', 30.0, 'MIN', 'LOWER_IS_BETTER', 110.0, 130.0)
ON CONFLICT (id) DO NOTHING;

-- 14. Operators
--
-- pin_hash is deliberately left NULL. The column holds a scrypt digest, and the
-- seed used to write the literal string '1234' into it, which no operator could
-- ever log in with — and, worse, a non-null value makes the bootstrap skip that
-- operator, so BOOTSTRAP_OPERATOR_PIN silently never applied either. An
-- operator receives a PIN from BOOTSTRAP_OPERATOR_PIN on first boot, or from an
-- administrator; a plaintext credential is never seeded.
INSERT INTO operator (id, tenant_id, employee_number, name, pin_hash, default_line_id, status)
VALUES
  ('op-001', 'tenant-pilot-factory-01', 'OP-1001', 'Budi Santoso', NULL, 'line-01', 'ACTIVE'),
  ('op-002', 'tenant-pilot-factory-01', 'OP-1002', 'Siti Rahmawati', NULL, 'line-01', 'ACTIVE'),
  ('op-003', 'tenant-pilot-factory-01', 'OP-1003', 'Agus Prasetyo', NULL, 'line-02', 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

-- 15. Production Orders & Batches
INSERT INTO production_order (id, tenant_id, order_number, product_id, quantity, due_date, status, created_by)
VALUES
  ('po-260829-001', 'tenant-pilot-factory-01', 'PO-260829-001', 'prod-tire-a', 2000, CURRENT_DATE + INTERVAL '2 days', 'RELEASED', 'PPIC Supervisor'),
  ('po-260829-002', 'tenant-pilot-factory-01', 'PO-260829-002', 'prod-tire-b', 1500, CURRENT_DATE + INTERVAL '3 days', 'RELEASED', 'PPIC Supervisor'),
  ('po-260829-003', 'tenant-pilot-factory-01', 'PO-260829-003', 'prod-tire-c', 800, CURRENT_DATE + INTERVAL '4 days', 'DRAFT', 'PPIC Supervisor')
ON CONFLICT (id) DO NOTHING;

-- (Batches are seeded after the work orders — see below.)

-- 16. Work Orders (Multi-Process Sequence per Routing)
-- Production Plan and Plan Line: a Work Order belongs to a plan line, not to a
-- Production Order (ADR-16). production_plan_line_id is NOT NULL since §22
-- step 15.
INSERT INTO production_plan (id, tenant_id, plan_number, period_start, period_end, status, wizard_step)
VALUES
  ('plan-seed-001', 'tenant-pilot-factory-01', 'PLAN-SEED-001', CURRENT_DATE, CURRENT_DATE + 7, 'CONFIRMED', 6),
  ('plan-seed-002', 'tenant-pilot-factory-01', 'PLAN-SEED-002', CURRENT_DATE, CURRENT_DATE + 9, 'CONFIRMED', 6)
ON CONFLICT (id) DO NOTHING;

INSERT INTO production_plan_line (id, tenant_id, production_plan_id, product_id, demand_quantity, planned_quantity, required_delivery_date, priority, capacity_status, status)
VALUES
  ('planline-seed-001', 'tenant-pilot-factory-01', 'plan-seed-001', 'prod-tire-a', 2000, 2000, CURRENT_DATE + 2, 1, 'WITHIN_PLAN', 'CONFIRMED'),
  ('planline-seed-002', 'tenant-pilot-factory-01', 'plan-seed-002', 'prod-tire-b', 1500, 1500, CURRENT_DATE + 3, 1, 'WITHIN_PLAN', 'CONFIRMED')
ON CONFLICT (id) DO NOTHING;

-- output_quantity is what passed quality; reject is a separate bucket and is
-- never folded in (ADR-23). work_order.good_quantity no longer exists.
INSERT INTO work_order (id, tenant_id, production_order_id, production_plan_line_id, wo_number, product_id, process_id, sequence, line_id, work_center_id, machine_id, target_quantity, planned_quantity, unit, planned_start, planned_end, input_quantity, output_quantity, reject_quantity, scrap_quantity, rework_quantity, transferred_quantity, status, priority)
VALUES
  ('wo-101', 'tenant-pilot-factory-01', 'po-260829-001', 'planline-seed-001', 'WO-260829-01-MIX', 'prod-tire-a', 'proc-mixing', 1, 'line-01', 'wc-mixing', 'mc-mix-01', 2000, 2000, 'PCS', CURRENT_TIMESTAMP - INTERVAL '4 hours', CURRENT_TIMESTAMP + INTERVAL '4 hours', 1465, 1450, 15, 0, 0, 1450, 'IN_PRODUCTION', 1),
  ('wo-102', 'tenant-pilot-factory-01', 'po-260829-001', 'planline-seed-001', 'WO-260829-01-TBM', 'prod-tire-a', 'proc-building', 3, 'line-01', 'wc-building', 'mc-tbm-01', 2000, 2000, 'PCS', CURRENT_TIMESTAMP - INTERVAL '2 hours', CURRENT_TIMESTAMP + INTERVAL '6 hours', 992, 980, 12, 0, 0, 980, 'IN_PRODUCTION', 1),
  ('wo-103', 'tenant-pilot-factory-01', 'po-260829-001', 'planline-seed-001', 'WO-260829-01-CPR', 'prod-tire-a', 'proc-curing', 4, 'line-01', 'wc-curing', 'mc-cpr-01', 2000, 2000, 'PCS', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '8 hours', 488, 480, 8, 0, 0, 480, 'IN_PRODUCTION', 1),
  ('wo-104', 'tenant-pilot-factory-01', 'po-260829-001', 'planline-seed-001', 'WO-260829-01-INS', 'prod-tire-a', 'proc-inspection', 5, 'line-01', 'wc-inspection', 'mc-ins-01', 2000, 2000, 'PCS', CURRENT_TIMESTAMP + INTERVAL '2 hours', CURRENT_TIMESTAMP + INTERVAL '10 hours', 0, 0, 0, 0, 0, 0, 'CONFIRMED', 1),
  -- Order 002 carries batch-260829-02. Under the v1.0 model a batch belongs to a
  -- Work Order, not to a Production Order (ADR-29), so the order needs work
  -- orders of its own — without them the batch would be an orphan that MES-011
  -- rightly refuses to migrate.
  ('wo-201', 'tenant-pilot-factory-01', 'po-260829-002', 'planline-seed-002', 'WO-260829-02-MIX', 'prod-tire-b', 'proc-mixing', 1, 'line-02', 'wc-mixing', 'mc-mix-02', 1500, 1500, 'PCS', CURRENT_TIMESTAMP - INTERVAL '3 hours', CURRENT_TIMESTAMP + INTERVAL '5 hours', 910, 900, 10, 0, 0, 900, 'IN_PRODUCTION', 1),
  ('wo-202', 'tenant-pilot-factory-01', 'po-260829-002', 'planline-seed-002', 'WO-260829-02-TBM', 'prod-tire-b', 'proc-building', 3, 'line-02', 'wc-building', 'mc-tbm-02', 1500, 1500, 'PCS', CURRENT_TIMESTAMP - INTERVAL '1 hours', CURRENT_TIMESTAMP + INTERVAL '7 hours', 426, 420, 6, 0, 0, 420, 'IN_PRODUCTION', 1)
ON CONFLICT (id) DO NOTHING;

-- 17. Production Batches (ADR-29: a batch belongs to a Work Order)
INSERT INTO production_batch (
  id, tenant_id, batch_number, work_order_id, product_id, process_id, sequence,
  planned_quantity, input_quantity, output_quantity,
  reject_quantity, scrap_quantity, rework_quantity, transferred_quantity,
  production_date, status
)
VALUES
  ('batch-260829-01', 'tenant-pilot-factory-01', 'B260829-01', 'wo-101', 'prod-tire-a', 'proc-mixing', 1,
   1000, 1465, 1450, 15, 0, 0, 1450, CURRENT_DATE, 'IN_PRODUCTION'),
  ('batch-260829-02', 'tenant-pilot-factory-01', 'B260829-02', 'wo-201', 'prod-tire-b', 'proc-mixing', 1,
   750, 910, 900, 10, 0, 0, 900, CURRENT_DATE, 'IN_PRODUCTION')
ON CONFLICT (id) DO NOTHING;

-- The two work orders that own a batch must be batch-managed, or E1/E2 would
-- reject any production record written against them.
UPDATE work_order SET is_batch_managed = TRUE WHERE id IN ('wo-101', 'wo-201');
