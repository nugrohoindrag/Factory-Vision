-- ============================================================================
-- Legacy fixture — a v1.5-shaped database, for Sprint 2 migration testing
-- ============================================================================
-- Stands in for the pilot dump until the real one is available. It reproduces
-- the conditions the Sprint 2 migrations must survive, each of which was found
-- in real data or in the shipped seed:
--
--   L1  Production Orders with no Production Plan yet
--   L2  Work Orders on a non-contiguous routing sequence (1, 3, 4, 5)
--   L3  One legacy batch referenced by several Work Orders (many -> one)
--   L4  Retired statuses: RELEASED, IN_PROGRESS, PAUSED
--   L5  A downtime record left ACTIVE on a PAUSED work order
--   L6  A parent/child Work Order pair, with records only on the child
--   L7  good_quantity present, output_quantity absent
--
-- Applied AFTER migrations 001-009 and BEFORE 010-013, so it exercises the
-- migrations rather than the final schema.

INSERT INTO tenant (id, name, timezone, plan, status)
VALUES ('t-legacy', 'Legacy Fixture Co', 'Asia/Jakarta', 'MID_MARKET', 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

INSERT INTO plant (id, tenant_id, name, location, timezone, status)
VALUES ('lg-plant', 't-legacy', 'Legacy Plant', 'Bekasi', 'Asia/Jakarta', 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

INSERT INTO production_line (id, tenant_id, plant_id, code, name, status, planned_production_time_minutes)
VALUES ('lg-line', 't-legacy', 'lg-plant', 'LG1', 'Legacy Line', 'ACTIVE', 480)
ON CONFLICT (id) DO NOTHING;

INSERT INTO product (id, tenant_id, sku, name, unit, ideal_cycle_time_seconds, status)
VALUES ('lg-prod', 't-legacy', 'LG-SKU', 'Legacy Product', 'PCS', 60, 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

INSERT INTO production_process (id, tenant_id, code, name, sequence_default, status)
VALUES
  ('lg-inj',  't-legacy', 'INJECTION', 'Injection', 1, 'ACTIVE'),
  ('lg-pnt',  't-legacy', 'PAINTING',  'Painting',  2, 'ACTIVE'),
  ('lg-sub',  't-legacy', 'SUB_ASSY',  'Sub Assy',  3, 'ACTIVE'),
  ('lg-main', 't-legacy', 'MAIN_ASSY', 'Main Assy', 4, 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

-- L2: the routing itself is contiguous; the work orders below are not.
INSERT INTO product_routing (id, tenant_id, product_id, process_id, sequence, active)
VALUES
  ('lg-rt1', 't-legacy', 'lg-prod', 'lg-inj',  1, true),
  ('lg-rt2', 't-legacy', 'lg-prod', 'lg-pnt',  2, true),
  ('lg-rt3', 't-legacy', 'lg-prod', 'lg-sub',  3, true),
  ('lg-rt4', 't-legacy', 'lg-prod', 'lg-main', 4, true)
ON CONFLICT (id) DO NOTHING;

-- L1: two production orders, no plan
INSERT INTO production_order (id, tenant_id, order_number, product_id, quantity, due_date, status, created_by)
VALUES
  ('lg-po-1', 't-legacy', 'LG-PO-001', 'lg-prod', 10000, CURRENT_DATE + 5, 'RELEASED', 'ppic'),
  ('lg-po-2', 't-legacy', 'LG-PO-002', 'lg-prod',  4000, CURRENT_DATE + 9, 'PLANNED',  'ppic')
ON CONFLICT (id) DO NOTHING;

-- L3: one batch, about to be referenced by four work orders
INSERT INTO production_batch (id, tenant_id, batch_number, product_id, production_order_id, production_date, status)
VALUES ('lg-batch-1', 't-legacy', 'LGB-001', 'lg-prod', 'lg-po-1', CURRENT_DATE, 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

-- L2 + L3 + L4 + L7: non-contiguous sequence, shared batch, retired statuses,
-- good_quantity with no output_quantity.
INSERT INTO work_order (
  id, tenant_id, production_order_id, wo_number, product_id, process_id, sequence,
  batch_id, line_id, machine_id, target_quantity, unit,
  planned_start, planned_end, good_quantity, reject_quantity, status, priority
) VALUES
  ('lg-wo-s1', 't-legacy', 'lg-po-1', 'LG-WO-S1', 'lg-prod', 'lg-inj',  1, 'lg-batch-1', 'lg-line', 'm-1', 10000, 'PCS',
   CURRENT_TIMESTAMP - INTERVAL '6 hours', CURRENT_TIMESTAMP + INTERVAL '2 hours', 9800, 100, 'IN_PROGRESS', 1),
  ('lg-wo-s3', 't-legacy', 'lg-po-1', 'LG-WO-S3', 'lg-prod', 'lg-pnt',  3, 'lg-batch-1', 'lg-line', 'm-2', 10000, 'PCS',
   CURRENT_TIMESTAMP - INTERVAL '4 hours', CURRENT_TIMESTAMP + INTERVAL '4 hours', 9700,  50, 'PAUSED', 1),
  ('lg-wo-s4', 't-legacy', 'lg-po-1', 'LG-WO-S4', 'lg-prod', 'lg-sub',  4, 'lg-batch-1', 'lg-line', 'm-3', 10000, 'PCS',
   CURRENT_TIMESTAMP - INTERVAL '2 hours', CURRENT_TIMESTAMP + INTERVAL '6 hours',    0,   0, 'RELEASED', 1),
  ('lg-wo-s5', 't-legacy', 'lg-po-1', 'LG-WO-S5', 'lg-prod', 'lg-main', 5, 'lg-batch-1', 'lg-line', 'm-4', 10000, 'PCS',
   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '8 hours', 0, 0, 'DRAFT', 1)
ON CONFLICT (id) DO NOTHING;

-- L6: parent with two children. Records belong to a child, never to the parent.
INSERT INTO work_order (
  id, tenant_id, production_order_id, wo_number, product_id, process_id, sequence,
  line_id, machine_id, target_quantity, unit,
  planned_start, planned_end, good_quantity, reject_quantity, status, priority
) VALUES
  ('lg-wo-p', 't-legacy', 'lg-po-2', 'LG-WO-P', 'lg-prod', 'lg-inj', 1, 'lg-line', 'm-1', 4000, 'PCS',
   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '8 hours', 0, 0, 'RELEASED', 1),
  ('lg-wo-c1', 't-legacy', 'lg-po-2', 'LG-WO-P-01', 'lg-prod', 'lg-inj', 1, 'lg-line', 'm-1', 2400, 'PCS',
   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '8 hours', 2350, 20, 'IN_PROGRESS', 1),
  ('lg-wo-c2', 't-legacy', 'lg-po-2', 'LG-WO-P-02', 'lg-prod', 'lg-inj', 1, 'lg-line', 'm-2', 1600, 'PCS',
   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '8 hours', 1560, 15, 'IN_PROGRESS', 1)
ON CONFLICT (id) DO NOTHING;

UPDATE work_order SET parent_work_order_id = 'lg-wo-p' WHERE id IN ('lg-wo-c1', 'lg-wo-c2');

-- Production records on the child, none on the parent.
INSERT INTO production_record (
  id, tenant_id, work_order_id, process_id, machine_id, operator_id, shift_id, shift_date,
  good_quantity, reject_quantity, recorded_at, client_event_id
) VALUES
  ('lg-pr-1', 't-legacy', 'lg-wo-c1', 'lg-inj', 'm-1', 'op-1', 'sh-1', CURRENT_DATE, 2350, 20, CURRENT_TIMESTAMP, 'lg-ce-1'),
  ('lg-pr-2', 't-legacy', 'lg-wo-c2', 'lg-inj', 'm-2', 'op-1', 'sh-1', CURRENT_DATE, 1560, 15, CURRENT_TIMESTAMP, 'lg-ce-2')
ON CONFLICT (id) DO NOTHING;

-- L5: downtime left ACTIVE on the PAUSED work order
INSERT INTO downtime_record (
  id, tenant_id, work_order_id, process_id, machine_id, line_id, shift_id, shift_date,
  reason_id, start_time, is_planned, status, client_event_id
) VALUES
  ('lg-dt-1', 't-legacy', 'lg-wo-s3', 'lg-pnt', 'm-2', 'lg-line', 'sh-1', CURRENT_DATE,
   'dt-breakdown', CURRENT_TIMESTAMP - INTERVAL '90 minutes', false, 'ACTIVE', 'lg-dt-ce-1')
ON CONFLICT (id) DO NOTHING;
