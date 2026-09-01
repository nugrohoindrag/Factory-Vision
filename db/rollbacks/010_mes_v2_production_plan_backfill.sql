-- ============================================================================
-- Rollback 010 — Production Order → Production Plan backfill (MES-009)
-- ============================================================================
-- Removes only the rows this migration created. Plans authored by hand carry a
-- different id prefix and are left untouched, and production_order is not
-- modified at all: migration 010 never wrote to it.

DELETE FROM production_plan_line WHERE id LIKE 'planline-mig-%';
DELETE FROM production_plan      WHERE id LIKE 'plan-mig-%';
