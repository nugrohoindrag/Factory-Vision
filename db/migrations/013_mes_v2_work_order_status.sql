-- ============================================================================
-- 013  MES Improvement v1.0 — Work Order status vocabulary migration
--      MES-012 (Sprint 2), Technical Design §22 step 12
-- ============================================================================
-- RELEASED -> CONFIRMED, IN_PROGRESS -> IN_PRODUCTION, PAUSED -> IN_PRODUCTION
-- (ADR-18). PAUSED disappears entirely: a stopped machine is a machine state
-- plus an open downtime record, never a work order status.

UPDATE work_order SET status = 'CONFIRMED'     WHERE status = 'RELEASED';
UPDATE work_order SET status = 'IN_PRODUCTION' WHERE status IN ('IN_PROGRESS', 'PAUSED');

-- Downtime left open on a work order that is no longer running would block the
-- IN_PRODUCTION -> COMPLETED guard forever, so it is closed and its duration
-- computed from the timestamps that already exist.
--
-- Downtime open on a work order that IS running is left alone: a work order
-- that was PAUSED is now IN_PRODUCTION with an active downtime, and that
-- pairing is exactly how the new model represents a stopped job (ADR-18). It is
-- not dangling — the operator resumes and it closes.
UPDATE downtime_record
SET end_time = COALESCE(end_time, CURRENT_TIMESTAMP),
    duration_seconds = COALESCE(
      duration_seconds,
      GREATEST(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - start_time))::INT, 0)
    ),
    status = 'RESOLVED'
WHERE status = 'ACTIVE'
  AND work_order_id IN (
    SELECT id FROM work_order WHERE status IN ('COMPLETED', 'CANCELLED')
  );

-- --- Verification ------------------------------------------------------------
DO $$
DECLARE
  legacy_status INT;
  dangling_dt   INT;
BEGIN
  SELECT COUNT(*) INTO legacy_status
  FROM work_order WHERE status IN ('RELEASED', 'IN_PROGRESS', 'PAUSED');
  IF legacy_status > 0 THEN
    RAISE EXCEPTION
      'MES-012 verification failed: % work order(s) still carry a retired status', legacy_status;
  END IF;

  SELECT COUNT(*) INTO dangling_dt
  FROM downtime_record dr
  JOIN work_order wo ON wo.id = dr.work_order_id
  WHERE dr.status = 'ACTIVE' AND wo.status IN ('COMPLETED', 'CANCELLED');
  IF dangling_dt > 0 THEN
    RAISE EXCEPTION
      'MES-012 verification failed: % downtime record(s) still open on a finished work order', dangling_dt;
  END IF;
END $$;
