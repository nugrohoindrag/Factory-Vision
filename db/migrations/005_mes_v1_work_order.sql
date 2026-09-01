-- ============================================================================
-- 005  MES Improvement v1.0 — Work Order, Batch & Execution Path Exclusivity
-- (MES-001, MES-002, MES-003, MES-115)
-- ============================================================================
-- 1. Updates work_order with process-level execution, routing, hierarchy,
--    resource assignments, batch mode, split mode, and 7-column quantity flow.
-- 2. Updates production_batch with quantity flow and nullable actual resources.
-- 3. Enforces Execution Path Exclusivity (E1, E2, E3) declaratively via
--    Composite FKs + CHECK constraints on production_record (ADR-33, ADR-35).

DO $$
BEGIN
  -- === 1. WORK_ORDER COLUMNS ===

  -- Reference to Production Plan Line (MES-001-1)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_order' AND column_name = 'production_plan_line_id'
  ) THEN
    ALTER TABLE work_order ADD COLUMN production_plan_line_id VARCHAR(64);
  END IF;

  -- Routing Reference & Sequence (MES-001-1)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_order' AND column_name = 'routing_id'
  ) THEN
    ALTER TABLE work_order ADD COLUMN routing_id VARCHAR(64) REFERENCES product_routing(id);
  END IF;

  -- Parent & Predecessor Hierarchy (MES-001-2)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_order' AND column_name = 'parent_work_order_id'
  ) THEN
    ALTER TABLE work_order ADD COLUMN parent_work_order_id VARCHAR(64) REFERENCES work_order(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_order' AND column_name = 'predecessor_work_order_id'
  ) THEN
    ALTER TABLE work_order ADD COLUMN predecessor_work_order_id VARCHAR(64) REFERENCES work_order(id);
  END IF;

  -- Batch Mode Flag (MES-001-3, MES-003)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_order' AND column_name = 'is_batch_managed'
  ) THEN
    ALTER TABLE work_order ADD COLUMN is_batch_managed BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;

  -- Parent Split Flag (MES-115)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_order' AND column_name = 'has_child_work_order'
  ) THEN
    ALTER TABLE work_order ADD COLUMN has_child_work_order BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;

  -- Resource Assignments: mold_id, shift_id (MES-001-4)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_order' AND column_name = 'mold_id'
  ) THEN
    ALTER TABLE work_order ADD COLUMN mold_id VARCHAR(64);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_order' AND column_name = 'shift_id'
  ) THEN
    ALTER TABLE work_order ADD COLUMN shift_id VARCHAR(64) REFERENCES shift(id);
  END IF;

  -- Production Quantity Flow (MES-001-5, MES-001-6)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_order' AND column_name = 'planned_quantity'
  ) THEN
    ALTER TABLE work_order ADD COLUMN planned_quantity INT NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_order' AND column_name = 'input_quantity'
  ) THEN
    ALTER TABLE work_order ADD COLUMN input_quantity INT NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_order' AND column_name = 'output_quantity'
  ) THEN
    ALTER TABLE work_order ADD COLUMN output_quantity INT NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_order' AND column_name = 'scrap_quantity'
  ) THEN
    ALTER TABLE work_order ADD COLUMN scrap_quantity INT NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_order' AND column_name = 'rework_quantity'
  ) THEN
    ALTER TABLE work_order ADD COLUMN rework_quantity INT NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_order' AND column_name = 'transferred_quantity'
  ) THEN
    ALTER TABLE work_order ADD COLUMN transferred_quantity INT NOT NULL DEFAULT 0;
  END IF;

  -- Confirmation Metadata
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_order' AND column_name = 'confirmed_by'
  ) THEN
    ALTER TABLE work_order ADD COLUMN confirmed_by VARCHAR(64);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_order' AND column_name = 'confirmed_at'
  ) THEN
    ALTER TABLE work_order ADD COLUMN confirmed_at TIMESTAMP WITH TIME ZONE;
  END IF;

  -- Decouple production_order_id (make nullable for future drop in S2)
  ALTER TABLE work_order ALTER COLUMN production_order_id DROP NOT NULL;

END $$;

-- Backfill planned_quantity & output_quantity on work_order
UPDATE work_order
SET planned_quantity = target_quantity
WHERE (planned_quantity = 0 OR planned_quantity IS NULL) AND target_quantity IS NOT NULL;

-- `good_quantity` is a legacy column that migration 011 drops once
-- `output_quantity` has been verified. Guarded by existence so this migration
-- can still be replayed against a database that has already been through 011 —
-- a re-migration must not fail on a column the schema has deliberately retired.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_order' AND column_name = 'good_quantity'
  ) THEN
    EXECUTE $sql$
      UPDATE work_order
      SET output_quantity = COALESCE(good_quantity, 0)
      WHERE (output_quantity = 0 OR output_quantity IS NULL) AND good_quantity IS NOT NULL
    $sql$;
  END IF;
END $$;

-- Unique constraints on work_order for composite FKs
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_wo_batch_mode') THEN
    ALTER TABLE work_order ADD CONSTRAINT uq_wo_batch_mode UNIQUE (id, is_batch_managed);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_wo_exec_mode') THEN
    ALTER TABLE work_order ADD CONSTRAINT uq_wo_exec_mode UNIQUE (id, is_batch_managed, has_child_work_order);
  END IF;
END $$;


-- === 2. PRODUCTION_BATCH TABLE UPDATES (MES-002) ===
DO $$
BEGIN
  -- Add missing columns to production_batch
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'production_batch' AND column_name = 'work_order_id') THEN
    ALTER TABLE production_batch ADD COLUMN work_order_id VARCHAR(64) REFERENCES work_order(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'production_batch' AND column_name = 'process_id') THEN
    ALTER TABLE production_batch ADD COLUMN process_id VARCHAR(64) REFERENCES production_process(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'production_batch' AND column_name = 'sequence') THEN
    ALTER TABLE production_batch ADD COLUMN sequence INT NOT NULL DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'production_batch' AND column_name = 'planned_quantity') THEN
    ALTER TABLE production_batch ADD COLUMN planned_quantity INT NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'production_batch' AND column_name = 'input_quantity') THEN
    ALTER TABLE production_batch ADD COLUMN input_quantity INT NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'production_batch' AND column_name = 'output_quantity') THEN
    ALTER TABLE production_batch ADD COLUMN output_quantity INT NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'production_batch' AND column_name = 'reject_quantity') THEN
    ALTER TABLE production_batch ADD COLUMN reject_quantity INT NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'production_batch' AND column_name = 'scrap_quantity') THEN
    ALTER TABLE production_batch ADD COLUMN scrap_quantity INT NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'production_batch' AND column_name = 'rework_quantity') THEN
    ALTER TABLE production_batch ADD COLUMN rework_quantity INT NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'production_batch' AND column_name = 'transferred_quantity') THEN
    ALTER TABLE production_batch ADD COLUMN transferred_quantity INT NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'production_batch' AND column_name = 'status_reason') THEN
    ALTER TABLE production_batch ADD COLUMN status_reason TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'production_batch' AND column_name = 'material_lot_reference') THEN
    ALTER TABLE production_batch ADD COLUMN material_lot_reference VARCHAR(128);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'production_batch' AND column_name = 'machine_id') THEN
    ALTER TABLE production_batch ADD COLUMN machine_id VARCHAR(64);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'production_batch' AND column_name = 'mold_id') THEN
    ALTER TABLE production_batch ADD COLUMN mold_id VARCHAR(64);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'production_batch' AND column_name = 'operator_id') THEN
    ALTER TABLE production_batch ADD COLUMN operator_id VARCHAR(64);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'production_batch' AND column_name = 'shift_id') THEN
    ALTER TABLE production_batch ADD COLUMN shift_id VARCHAR(64) REFERENCES shift(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'production_batch' AND column_name = 'expiry_date') THEN
    ALTER TABLE production_batch ADD COLUMN expiry_date DATE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'production_batch' AND column_name = 'actual_start') THEN
    ALTER TABLE production_batch ADD COLUMN actual_start TIMESTAMP WITH TIME ZONE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'production_batch' AND column_name = 'actual_end') THEN
    ALTER TABLE production_batch ADD COLUMN actual_end TIMESTAMP WITH TIME ZONE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'production_batch' AND column_name = 'version') THEN
    ALTER TABLE production_batch ADD COLUMN version INT NOT NULL DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'production_batch' AND column_name = 'updated_at') THEN
    ALTER TABLE production_batch ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
  END IF;

  -- Make production_order_id nullable on production_batch
  ALTER TABLE production_batch ALTER COLUMN production_order_id DROP NOT NULL;

END $$;

-- Backfill production_batch.work_order_id from legacy work_order.batch_id.
-- `batch_id` is the pre-inversion relationship (WO → batch); migration 012
-- drops it once the inversion is verified, so this is guarded the same way.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_order' AND column_name = 'batch_id'
  ) THEN
    EXECUTE $sql$
      UPDATE production_batch pb
      SET work_order_id = wo.id
      FROM work_order wo
      WHERE wo.batch_id = pb.id AND (pb.work_order_id IS NULL OR pb.work_order_id = '')
    $sql$;
  END IF;
END $$;

-- If any production_batch still has no work_order_id, link to the first WO for its product/order
UPDATE production_batch pb
SET work_order_id = (SELECT wo.id FROM work_order wo WHERE wo.product_id = pb.product_id LIMIT 1)
WHERE pb.work_order_id IS NULL;

-- Assign continuous sequence numbers per (tenant_id, work_order_id)
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY tenant_id, work_order_id ORDER BY id) as seq
  FROM production_batch
)
UPDATE production_batch pb
SET sequence = numbered.seq
FROM numbered
WHERE pb.id = numbered.id;

-- Ensure constraints on production_batch
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_batch_wo') THEN
    ALTER TABLE production_batch ADD CONSTRAINT uq_batch_wo UNIQUE (id, work_order_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_prod_batch_wo_seq') THEN
    ALTER TABLE production_batch ADD CONSTRAINT uq_prod_batch_wo_seq UNIQUE (tenant_id, work_order_id, sequence);
  END IF;
END $$;

ALTER TABLE production_batch ENABLE ROW LEVEL SECURITY;


-- === 3. PRODUCTION_RECORD CONSTRAINTS (MES-003 & MES-115) ===
DO $$
BEGIN
  -- Columns on production_record
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'production_record' AND column_name = 'is_batch_managed'
  ) THEN
    ALTER TABLE production_record ADD COLUMN is_batch_managed BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'production_record' AND column_name = 'has_child_work_order'
  ) THEN
    ALTER TABLE production_record ADD COLUMN has_child_work_order BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'production_record' AND column_name = 'scrap_quantity'
  ) THEN
    ALTER TABLE production_record ADD COLUMN scrap_quantity INT NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'production_record' AND column_name = 'rework_quantity'
  ) THEN
    ALTER TABLE production_record ADD COLUMN rework_quantity INT NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'production_record' AND column_name = 'input_quantity'
  ) THEN
    ALTER TABLE production_record ADD COLUMN input_quantity INT NOT NULL DEFAULT 0;
  END IF;

END $$;

-- Backfill production_record flags from work_order
UPDATE production_record pr
SET is_batch_managed = wo.is_batch_managed,
    has_child_work_order = wo.has_child_work_order
FROM work_order wo
WHERE pr.work_order_id = wo.id;

-- For non-batch work orders, clear any legacy batch_id on production_record to satisfy E1
UPDATE production_record pr
SET batch_id = NULL
WHERE pr.is_batch_managed = FALSE AND pr.batch_id IS NOT NULL;

-- For batch-managed records, ensure batch.work_order_id matches record.work_order_id
UPDATE production_batch pb
SET work_order_id = pr.work_order_id
FROM production_record pr
WHERE pr.batch_id = pb.id AND pb.work_order_id != pr.work_order_id;

DO $$
BEGIN
  -- 1. Composite FK: Work Order Mode & Hierarchy (E1, E2, E3)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_prod_record_wo_exec_mode') THEN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_prod_record_wo_mode') THEN
      ALTER TABLE production_record DROP CONSTRAINT fk_prod_record_wo_mode;
    END IF;

    ALTER TABLE production_record
      ADD CONSTRAINT fk_prod_record_wo_exec_mode
      FOREIGN KEY (work_order_id, is_batch_managed, has_child_work_order)
      REFERENCES work_order (id, is_batch_managed, has_child_work_order)
      ON UPDATE CASCADE;
  END IF;

  -- 2. Composite FK: Batch must belong to same Work Order
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_prod_record_batch_wo') THEN
    ALTER TABLE production_record
      ADD CONSTRAINT fk_prod_record_batch_wo
      FOREIGN KEY (batch_id, work_order_id)
      REFERENCES production_batch (id, work_order_id);
  END IF;

  -- 3. CHECK E1/E2: Batch exclusivity
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_prod_record_batch_exclusive') THEN
    ALTER TABLE production_record
      ADD CONSTRAINT ck_prod_record_batch_exclusive
      CHECK (
        (is_batch_managed = FALSE AND batch_id IS NULL)
        OR
        (is_batch_managed = TRUE  AND batch_id IS NOT NULL)
      );
  END IF;

  -- 4. CHECK E3: Parent WO exclusivity (parent cannot have records directly)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_prod_record_not_parent') THEN
    ALTER TABLE production_record
      ADD CONSTRAINT ck_prod_record_not_parent
      CHECK (has_child_work_order = FALSE);
  END IF;

END $$;
