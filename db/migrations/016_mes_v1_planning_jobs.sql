-- ============================================================================
-- 016  MES Improvement v1.0 — Planning job queue (MES-027-5, MES-032-4)
-- ============================================================================
-- MES-027 requires the forecast to run "sebagai job worker, bukan di request
-- HTTP": a twelve-month aggregation over a pilot's order history is not work to
-- hold a browser open for, and a request that times out halfway leaves a
-- half-written snapshot.
--
-- The Technical Architecture names BullMQ on Redis (§ table 202). There is no
-- Redis in `deploy/docker-compose.yml` — the single-VPS stack is Postgres,
-- API, worker and web — so the queue is a table here, with `FOR UPDATE SKIP
-- LOCKED` doing the work a broker would. That keeps the contract (enqueue,
-- claim, complete, retry, dead-letter) so swapping in BullMQ later is a change
-- of adapter rather than of design, and it means the job survives a restart,
-- which an in-memory queue would not.

CREATE TABLE IF NOT EXISTS planning_job (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
  job_type VARCHAR(64) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  result JSONB,
  last_error TEXT,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  requested_by VARCHAR(64),
  enqueued_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP WITH TIME ZONE,
  finished_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT ck_planning_job_status
    CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED'))
);

-- The claim query's index: oldest pending job of any type, per tenant.
CREATE INDEX IF NOT EXISTS idx_planning_job_pending
  ON planning_job (status, enqueued_at)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_planning_job_tenant
  ON planning_job (tenant_id, job_type, enqueued_at DESC);

ALTER TABLE planning_job ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON planning_job;
CREATE POLICY tenant_isolation ON planning_job
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
ALTER TABLE planning_job FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factory_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON planning_job TO factory_app;
  END IF;
END $$;
