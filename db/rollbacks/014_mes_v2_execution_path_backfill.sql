-- ============================================================================
-- Rollback 014 — Execution path backfill (MES-013)
-- ============================================================================
-- Returns the flags to the state migration 005 left them in. The order matters:
-- production_record first, so the composite foreign key never sees a work order
-- whose flag has moved ahead of its records.
UPDATE production_record SET has_child_work_order = FALSE WHERE has_child_work_order = TRUE;
UPDATE work_order        SET has_child_work_order = FALSE WHERE has_child_work_order = TRUE;
