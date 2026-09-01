-- ============================================================================
-- Rollback 013 — Work Order status vocabulary (MES-012)
-- ============================================================================
-- Only the one-to-one half of the mapping is reversed.
--
-- RELEASED -> CONFIRMED is reversible. IN_PROGRESS and PAUSED both mapped to
-- IN_PRODUCTION, and nothing in the data records which of the two a work order
-- was, so restoring them would invent history: a merely running job would come
-- back paused, or a paused one running, and the downtime records would agree
-- with neither. IN_PRODUCTION is therefore left as it is.
UPDATE work_order SET status = 'RELEASED' WHERE status = 'CONFIRMED';

-- Downtime closed by the forward migration stays closed. Re-opening it would
-- recreate the dangling state that blocks the COMPLETED guard, which is the
-- very defect the forward migration exists to clear.
