-- ============================================================================
-- 002  Demo customer orders — the Sales -> Demand half of the pilot dataset
-- ============================================================================
-- 001 seeds the plant: products, lines, machines, work orders, batches. It
-- stops at production_order, so every Sales screen (Customer, Customer Order,
-- Order Allocation) opens empty and the demand side of planning has nothing to
-- plan from. This file fills that in.
--
-- Ids and codes are prefixed so they cannot collide with anything an operator
-- or a planner creates through the UI, and every insert is guarded on the
-- primary key *and* on the natural key behind each unique constraint
-- (uq_customer_code, uq_cust_order_num) — 001 taught us that ON CONFLICT (id)
-- alone is not enough to make a seed safe against a database that already
-- holds data.
--
-- Quantities respect ck_cust_order_line_planned: planned_quantity is never
-- greater than ordered_quantity.

-- --- 1. Customers ------------------------------------------------------------
-- Four buyers spanning the segments a tyre plant actually serves: two vehicle
-- assemblers on scheduled call-off, one distributor, one fleet operator.
INSERT INTO customer (id, tenant_id, code, name, pic_name, pic_contact, delivery_address, dock_number, status)
VALUES
  ('cust-demo-001', 'tenant-pilot-factory-01', 'CUST-AGM', 'PT Astra Gemilang Motor',
   'Rina Kusumawati', 'rina.k@agm.co.id',
   'Kawasan Industri Jababeka II, Jl. Industri Selatan 3 Blok GG No. 12, Cikarang, Bekasi 17530', 'DOCK-A1', 'ACTIVE'),
  ('cust-demo-002', 'tenant-pilot-factory-01', 'CUST-NKI', 'PT Nusantara Karya Indah',
   'Bambang Hariyanto', 'bambang.h@nki.co.id',
   'Kawasan Industri MM2100, Jl. Kalimantan Blok DD-7, Cikarang Barat, Bekasi 17520', 'DOCK-B2', 'ACTIVE'),
  ('cust-demo-003', 'tenant-pilot-factory-01', 'CUST-SBP', 'CV Sinar Ban Perkasa',
   'Yulianto Wijaya', 'yulianto@sinarbanperkasa.id',
   'Jl. Raya Bekasi Km 27 No. 45, Pondok Ungu, Bekasi Utara 17124', 'DOCK-C1', 'ACTIVE'),
  ('cust-demo-004', 'tenant-pilot-factory-01', 'CUST-TLB', 'PT Trans Logistik Bersama',
   'Dewi Anggraini', 'dewi.a@translogistik.co.id',
   'Jl. Cakung Cilincing Raya Km 3, Jakarta Timur 13910', 'DOCK-D3', 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

-- --- 2. Customer orders ------------------------------------------------------
-- Spread across the lifecycle so every status filter on the Order list has
-- something behind it, and across delivery dates so the late/at-risk views are
-- not empty either. Dates are relative to the day the seed runs, so the
-- dataset never looks stale.
INSERT INTO customer_order (
  id, tenant_id, order_number, customer_id, po_number, order_channel,
  order_date, requested_delivery_date, customer_pic, delivery_address, dock_number,
  status, created_by
)
VALUES
  -- Received, not yet planned: what the planner sees as incoming demand.
  ('cord-demo-001', 'tenant-pilot-factory-01', 'SO-DEMO-0001', 'cust-demo-001', 'PO-AGM-88214', 'PO_DOCUMENT',
   CURRENT_DATE - 1, CURRENT_DATE + 12, 'Rina Kusumawati',
   'Kawasan Industri Jababeka II, Jl. Industri Selatan 3 Blok GG No. 12, Cikarang, Bekasi 17530', 'DOCK-A1',
   'RECEIVED', 'Sales Admin'),
  ('cord-demo-002', 'tenant-pilot-factory-01', 'SO-DEMO-0002', 'cust-demo-003', 'PO-SBP-4471', 'EMAIL',
   CURRENT_DATE, CURRENT_DATE + 20, 'Yulianto Wijaya',
   'Jl. Raya Bekasi Km 27 No. 45, Pondok Ungu, Bekasi Utara 17124', 'DOCK-C1',
   'RECEIVED', 'Sales Admin'),

  -- Planned: demand has been allocated to a production plan.
  ('cord-demo-003', 'tenant-pilot-factory-01', 'SO-DEMO-0003', 'cust-demo-002', 'PO-NKI-20260', 'KANBAN_CARD',
   CURRENT_DATE - 4, CURRENT_DATE + 9, 'Bambang Hariyanto',
   'Kawasan Industri MM2100, Jl. Kalimantan Blok DD-7, Cikarang Barat, Bekasi 17520', 'DOCK-B2',
   'PLANNED', 'PPIC Supervisor'),

  -- In production: the shop floor is working against it right now.
  ('cord-demo-004', 'tenant-pilot-factory-01', 'SO-DEMO-0004', 'cust-demo-001', 'PO-AGM-88190', 'PO_DOCUMENT',
   CURRENT_DATE - 8, CURRENT_DATE + 4, 'Rina Kusumawati',
   'Kawasan Industri Jababeka II, Jl. Industri Selatan 3 Blok GG No. 12, Cikarang, Bekasi 17530', 'DOCK-A1',
   'IN_PRODUCTION', 'PPIC Supervisor'),
  ('cord-demo-005', 'tenant-pilot-factory-01', 'SO-DEMO-0005', 'cust-demo-004', 'PO-TLB-7702', 'INVOICE',
   CURRENT_DATE - 6, CURRENT_DATE + 2, 'Dewi Anggraini',
   'Jl. Cakung Cilincing Raya Km 3, Jakarta Timur 13910', 'DOCK-D3',
   'IN_PRODUCTION', 'PPIC Supervisor'),

  -- Produced and ready: the warehouse half of the board.
  ('cord-demo-006', 'tenant-pilot-factory-01', 'SO-DEMO-0006', 'cust-demo-002', 'PO-NKI-20188', 'KANBAN_CARD',
   CURRENT_DATE - 15, CURRENT_DATE + 1, 'Bambang Hariyanto',
   'Kawasan Industri MM2100, Jl. Kalimantan Blok DD-7, Cikarang Barat, Bekasi 17520', 'DOCK-B2',
   'READY_TO_SHIP', 'PPIC Supervisor'),

  -- Shipped and completed: history, so trend and achievement views have a past.
  ('cord-demo-007', 'tenant-pilot-factory-01', 'SO-DEMO-0007', 'cust-demo-003', 'PO-SBP-4402', 'EMAIL',
   CURRENT_DATE - 24, CURRENT_DATE - 5, 'Yulianto Wijaya',
   'Jl. Raya Bekasi Km 27 No. 45, Pondok Ungu, Bekasi Utara 17124', 'DOCK-C1',
   'SHIPPED', 'Sales Admin'),
  ('cord-demo-008', 'tenant-pilot-factory-01', 'SO-DEMO-0008', 'cust-demo-001', 'PO-AGM-88101', 'PO_DOCUMENT',
   CURRENT_DATE - 32, CURRENT_DATE - 12, 'Rina Kusumawati',
   'Kawasan Industri Jababeka II, Jl. Industri Selatan 3 Blok GG No. 12, Cikarang, Bekasi 17530', 'DOCK-A1',
   'COMPLETED', 'Sales Admin'),

  -- One cancelled order, because a status filter with nothing behind it is
  -- indistinguishable from a broken filter.
  ('cord-demo-009', 'tenant-pilot-factory-01', 'SO-DEMO-0009', 'cust-demo-004', 'PO-TLB-7655', 'MANUAL',
   CURRENT_DATE - 18, CURRENT_DATE + 6, 'Dewi Anggraini',
   'Jl. Cakung Cilincing Raya Km 3, Jakarta Timur 13910', 'DOCK-D3',
   'CANCELLED', 'Sales Admin')
ON CONFLICT (id) DO NOTHING;

-- --- 3. Order lines ----------------------------------------------------------
-- Multi-line orders where a real buyer would order more than one size, so the
-- allocation screen has something to split. planned_quantity tracks the order's
-- status: nothing planned while RECEIVED, fully planned once past it, and
-- produced_quantity only moves once production has actually run.
INSERT INTO customer_order_line (
  id, tenant_id, customer_order_id, product_id, model_type,
  ordered_quantity, unit, requested_delivery_date, planned_quantity, produced_quantity, line_no
)
VALUES
  -- SO-DEMO-0001, received: nothing planned yet.
  ('cordl-demo-001', 'tenant-pilot-factory-01', 'cord-demo-001', 'prod-tire-a', '185/65 R15',
   1200, 'PCS', CURRENT_DATE + 12, 0, 0, 1),
  ('cordl-demo-002', 'tenant-pilot-factory-01', 'cord-demo-001', 'prod-tire-b', '235/70 R16',
   400, 'PCS', CURRENT_DATE + 12, 0, 0, 2),

  -- SO-DEMO-0002, received.
  ('cordl-demo-003', 'tenant-pilot-factory-01', 'cord-demo-002', 'prod-tire-c', '195 R14C',
   900, 'PCS', CURRENT_DATE + 20, 0, 0, 1),

  -- SO-DEMO-0003, planned but not started.
  ('cordl-demo-004', 'tenant-pilot-factory-01', 'cord-demo-003', 'prod-tire-b', '235/70 R16',
   1500, 'PCS', CURRENT_DATE + 9, 1500, 0, 1),
  ('cordl-demo-005', 'tenant-pilot-factory-01', 'cord-demo-003', 'prod-tire-a', '185/65 R15',
   600, 'PCS', CURRENT_DATE + 9, 600, 0, 2),

  -- SO-DEMO-0004, in production and partly built.
  ('cordl-demo-006', 'tenant-pilot-factory-01', 'cord-demo-004', 'prod-tire-a', '185/65 R15',
   2000, 'PCS', CURRENT_DATE + 4, 2000, 1450, 1),

  -- SO-DEMO-0005, in production, earlier in the run.
  ('cordl-demo-007', 'tenant-pilot-factory-01', 'cord-demo-005', 'prod-tire-c', '195 R14C',
   800, 'PCS', CURRENT_DATE + 2, 800, 240, 1),

  -- SO-DEMO-0006, built and waiting on the dock.
  ('cordl-demo-008', 'tenant-pilot-factory-01', 'cord-demo-006', 'prod-tire-b', '235/70 R16',
   1000, 'PCS', CURRENT_DATE + 1, 1000, 1000, 1),

  -- SO-DEMO-0007, shipped.
  ('cordl-demo-009', 'tenant-pilot-factory-01', 'cord-demo-007', 'prod-tire-c', '195 R14C',
   750, 'PCS', CURRENT_DATE - 5, 750, 750, 1),

  -- SO-DEMO-0008, completed.
  ('cordl-demo-010', 'tenant-pilot-factory-01', 'cord-demo-008', 'prod-tire-a', '185/65 R15',
   1800, 'PCS', CURRENT_DATE - 12, 1800, 1800, 1),
  ('cordl-demo-011', 'tenant-pilot-factory-01', 'cord-demo-008', 'prod-tire-c', '195 R14C',
   500, 'PCS', CURRENT_DATE - 12, 500, 500, 2),

  -- SO-DEMO-0009, cancelled before anything was planned.
  ('cordl-demo-012', 'tenant-pilot-factory-01', 'cord-demo-009', 'prod-tire-b', '235/70 R16',
   650, 'PCS', CURRENT_DATE + 6, 0, 0, 1)
ON CONFLICT (id) DO NOTHING;
