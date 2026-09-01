-- ============================================================================
-- Rollback 015  Planning runtime support
-- ============================================================================
-- The tenant_isolation policies added by 015 are deliberately NOT dropped. They
-- close a hole (RLS enabled with no policy denies the application, RLS absent
-- exposes every tenant to every other), and a rollback that reopened it would
-- leave the database less safe than before the migration ran. Dropping the
-- tables below takes their policies with them.

DROP INDEX IF EXISTS uq_wo_plan_line_process;

ALTER TABLE production_plan_line DROP COLUMN IF EXISTS demand_forecast_line_id;
ALTER TABLE work_order DROP COLUMN IF EXISTS status_reason;
ALTER TABLE customer_order DROP COLUMN IF EXISTS status_reason;
ALTER TABLE production_plan DROP COLUMN IF EXISTS planning_utilization_pct;
ALTER TABLE production_plan DROP COLUMN IF EXISTS wizard_state;
ALTER TABLE capacity_plan_line DROP COLUMN IF EXISTS available_minutes;
ALTER TABLE capacity_plan_line DROP COLUMN IF EXISTS uncomputed_machines;
ALTER TABLE capacity_plan DROP COLUMN IF EXISTS superseded_by_id;
ALTER TABLE demand_forecast DROP COLUMN IF EXISTS superseded_by_id;
ALTER TABLE demand_forecast_line DROP COLUMN IF EXISTS months_with_history;
ALTER TABLE demand_forecast_line DROP COLUMN IF EXISTS insufficient_history;

DROP TABLE IF EXISTS customer_order_document;
DROP TABLE IF EXISTS planning_config;
DROP TABLE IF EXISTS outbox_event;
