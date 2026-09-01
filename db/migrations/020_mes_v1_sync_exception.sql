-- ============================================================================
-- 020  Sync Conflict & Exception Reporting (MES-082)
-- ============================================================================
--
-- A command the shop floor captured and the server would not take is the one
-- record that must never disappear quietly: it describes production that
-- physically happened. Until now `syncOfflineBatch` answered per command and
-- then forgot — the rejection lived only in the tablet's IndexedDB, so a
-- supervisor had no way to see it, and a reinstalled tablet lost it entirely.
--
-- This table is where a rejection goes to be seen. It stores the whole command
-- payload, so a supervisor can tell exactly what the operator tried to record,
-- and a human-readable reason rather than only an error code.
--
-- `line_id` and `shift_date` are denormalised on purpose: MES-082 asks for the
-- list per line and shift, and resolving them at read time would mean joining
-- back through a Work Order that may itself be the thing that was rejected.

CREATE TABLE IF NOT EXISTS sync_exception (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),

  -- The command as the terminal sent it.
  -- Wider than the 64 elsewhere: an available-quantity variance is filed under
  -- the command's own event id with a suffix, so that it is unique per command
  -- without colliding with the rejection the same command might also raise.
  client_event_id VARCHAR(128) NOT NULL,
  command_type VARCHAR(64) NOT NULL,
  work_order_id VARCHAR(64),
  operator_id VARCHAR(64),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMP WITH TIME ZONE,

  -- Why it was not applied.
  error_code VARCHAR(64) NOT NULL,
  -- In Indonesian, and phrased for a supervisor rather than a developer:
  -- MES-082 asks for "alasan penolakan yang dapat dibaca manusia".
  reason TEXT NOT NULL,
  retryable BOOLEAN NOT NULL DEFAULT FALSE,

  -- What it belongs to, for the per-line and per-shift lists.
  line_id VARCHAR(64),
  shift_date DATE,

  status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
  resolved_by VARCHAR(64),
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolution_note TEXT,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT chk_sync_exception_status CHECK (status IN ('OPEN', 'RESOLVED', 'IGNORED')),
  -- One row per rejected command. A terminal that retries a permanently
  -- rejected command must update the existing exception rather than filing a
  -- second one, or a bad shift would fill the supervisor's list with copies of
  -- the same problem.
  CONSTRAINT uq_sync_exception_event UNIQUE (tenant_id, client_event_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_exception_open
  ON sync_exception (tenant_id, status, created_at DESC)
  WHERE status = 'OPEN';

CREATE INDEX IF NOT EXISTS idx_sync_exception_line_shift
  ON sync_exception (tenant_id, line_id, shift_date);

CREATE INDEX IF NOT EXISTS idx_sync_exception_work_order
  ON sync_exception (tenant_id, work_order_id);

ALTER TABLE sync_exception ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_exception FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'sync_exception' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON sync_exception
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- The application role reads and writes it like any other tenant-scoped table.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factory_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON sync_exception TO factory_app;
  END IF;
END $$;
