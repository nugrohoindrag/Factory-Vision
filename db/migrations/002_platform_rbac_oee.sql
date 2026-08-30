-- Factory Vision, PRD v1.5 platform tables
--
-- Adds persistence for the user stories that the initial schema predates:
-- roles and permissions (US-006), operator PIN credentials and sessions
-- (US-002, US-005), shift handover (US-023), and the OEE definition and pilot
-- validation log (US-032-US-036).
--
-- Idempotent throughout, so it is safe to re-run against an existing pilot
-- database during on-premise installs.

-- === US-006: Roles & Permissions =========================================

CREATE TABLE IF NOT EXISTS role_definition (
 id VARCHAR(64) PRIMARY KEY,
 tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
 key VARCHAR(64) NOT NULL,
 name VARCHAR(128) NOT NULL,
 description TEXT DEFAULT '',
 -- System roles are seeded from the ACL baseline and may not be edited.
 is_system BOOLEAN NOT NULL DEFAULT FALSE,
 landing_path VARCHAR(255) NOT NULL DEFAULT '/',
 created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT role_definition_tenant_key_unique UNIQUE (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS role_permission (
 role_id VARCHAR(64) NOT NULL REFERENCES role_definition(id) ON DELETE CASCADE,
 -- Always `module:action`.
 permission VARCHAR(64) NOT NULL,
 PRIMARY KEY (role_id, permission)
);

CREATE INDEX IF NOT EXISTS idx_role_definition_tenant ON role_definition(tenant_id);

-- === US-002: Operator credentials ========================================
-- Kept out of the `operator` row so a PIN hash never travels with the roster
-- payload the terminal reads to render its login picker.

CREATE TABLE IF NOT EXISTS operator_credential (
 operator_id VARCHAR(64) PRIMARY KEY REFERENCES operator(id) ON DELETE CASCADE,
 tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
 pin_hash VARCHAR(255) NOT NULL,
 updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
 updated_by VARCHAR(64)
);

-- === US-001, US-005: Sessions ============================================

CREATE TABLE IF NOT EXISTS auth_session (
 id VARCHAR(64) PRIMARY KEY,
 tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
 kind VARCHAR(16) NOT NULL CHECK (kind IN ('APPLICATION', 'OPERATOR')),
 -- app_user.id or operator.id depending on `kind`.
 subject_id VARCHAR(64) NOT NULL,
 token_hash VARCHAR(255) NOT NULL,
 issued_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
 last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
 -- Absolute expiry; operator sessions are deliberately short.
 expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
 -- Idle expiry, slid forward on each authenticated request.
 idle_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
 revoked_at TIMESTAMP WITH TIME ZONE,
 revoked_by VARCHAR(64),
 ip_address VARCHAR(64),
 user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_auth_session_subject ON auth_session(tenant_id, subject_id);
CREATE INDEX IF NOT EXISTS idx_auth_session_token ON auth_session(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_session_expiry ON auth_session(expires_at);

-- === US-023: Shift handover ==============================================

CREATE TABLE IF NOT EXISTS shift_handover (
 id VARCHAR(64) PRIMARY KEY,
 tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
 line_id VARCHAR(64) NOT NULL REFERENCES production_line(id),
 shift_id VARCHAR(64) NOT NULL REFERENCES shift(id),
 -- Production date, per the rule (the date the shift started).
 shift_date DATE NOT NULL,
 outgoing_supervisor_id VARCHAR(64),
 outgoing_supervisor_name VARCHAR(255),
 incoming_supervisor_id VARCHAR(64),
 incoming_supervisor_name VARCHAR(255),
 notes TEXT NOT NULL,
 open_issues JSONB DEFAULT '[]'::jsonb,
 acknowledged_at TIMESTAMP WITH TIME ZONE,
 created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
 -- One handover per line per shift per day: a second record would leave the
 -- incoming supervisor guessing which note is current.
 CONSTRAINT shift_handover_unique UNIQUE (tenant_id, line_id, shift_id, shift_date)
);

CREATE INDEX IF NOT EXISTS idx_shift_handover_lookup ON shift_handover(tenant_id, line_id, shift_date DESC);

-- === US-032-US-035: OEE calculation configuration ========================

CREATE TABLE IF NOT EXISTS oee_config (
 tenant_id VARCHAR(64) PRIMARY KEY REFERENCES tenant(id),
 -- Stamped onto every computed OEE row so a figure is always traceable to the
 -- definition that produced it. Bumped whenever a definition below changes.
 calc_version INTEGER NOT NULL DEFAULT 1,
 -- baseline is FALSE: planned downtime stays inside Planned
 -- Production Time and therefore also lowers Availability.
 ppt_excludes_planned_downtime BOOLEAN NOT NULL DEFAULT FALSE,
 ideal_cycle_source VARCHAR(32) NOT NULL DEFAULT 'PRODUCT_MACHINE'
 CHECK (ideal_cycle_source IN ('PRODUCT_MACHINE', 'ROUTING', 'PRODUCT')),
 -- forbids a silent default when the rate is missing.
 allow_ideal_cycle_fallback BOOLEAN NOT NULL DEFAULT FALSE,
 updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
 updated_by VARCHAR(64)
);

-- === US-036: Pilot OEE validation log (V1-V6) ============================

CREATE TABLE IF NOT EXISTS oee_validation_entry (
 id VARCHAR(64) PRIMARY KEY,
 tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
 item VARCHAR(4) NOT NULL CHECK (item IN ('V1', 'V2', 'V3', 'V4', 'V5', 'V6')),
 title VARCHAR(255) NOT NULL,
 scope_label VARCHAR(255),
 shift_date DATE,
 mes_value NUMERIC(10, 2),
 factory_value NUMERIC(10, 2),
 gap NUMERIC(10, 2),
 gap_class VARCHAR(32) NOT NULL DEFAULT 'NONE'
 CHECK (gap_class IN ('DEFINITION', 'DATA_CAPTURE', 'MASTER_DATA', 'NONE')),
 status VARCHAR(16) NOT NULL DEFAULT 'OPEN'
 CHECK (status IN ('OPEN', 'IN_REVIEW', 'RESOLVED')),
 resolution TEXT DEFAULT '',
 -- A definition gap must be closed by configuration + recompute, never an
 -- ad-hoc patch.
 resolved_by_config_change BOOLEAN NOT NULL DEFAULT FALSE,
 calc_version INTEGER NOT NULL DEFAULT 1,
 notes TEXT DEFAULT '',
 recorded_by VARCHAR(64),
 recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT oee_validation_entry_unique UNIQUE (tenant_id, item)
);

-- === US-046: Offline sync ledger =========================================
-- The server-side record of accepted client events. The unique constraint is
-- what makes replay after a reconnect idempotent rather than duplicating
-- production.

CREATE TABLE IF NOT EXISTS sync_event (
 tenant_id VARCHAR(64) NOT NULL REFERENCES tenant(id),
 client_event_id VARCHAR(64) NOT NULL,
 command_type VARCHAR(32) NOT NULL,
 work_order_id VARCHAR(64),
 entity_id VARCHAR(64),
 applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (tenant_id, client_event_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_event_work_order ON sync_event(tenant_id, work_order_id);

-- === Row Level Security ==================================================
--
-- Migration 001 enabled RLS on every table but defined no policies. With RLS
-- on and no policy, PostgreSQL denies all rows to non-owner roles, which
-- looks like isolation but is really just an outage waiting for the first
-- least-privilege deployment, and gives no isolation at all to the owner role
-- most installs actually connect as.
--
-- This adds the policy that makes rule 7 ("cross-tenant access is
-- prohibited") true at the database, not only in application code: every row
-- is visible only when it belongs to the tenant the connection has declared.
--
-- The API sets it per request:
-- SET LOCAL app.tenant_id = '<tenant>';
-- `current_setting(... true)` returns NULL when unset, so a connection that
-- forgets to declare a tenant sees nothing rather than everything.

ALTER TABLE role_definition ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_credential ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_handover ENABLE ROW LEVEL SECURITY;
ALTER TABLE oee_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE oee_validation_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_event ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
 target_table TEXT;
 tenant_scoped_tables TEXT[]:= ARRAY[
 'plant', 'production_line', 'work_center', 'production_process', 'machine',
 'product', 'product_machine_rate', 'product_routing', 'operator', 'shift',
 'downtime_reason', 'downtime_reason_scope', 'reject_reason', 'reject_reason_scope',
 'production_order', 'production_batch', 'work_order', 'production_record',
 'downtime_record', 'machine_state_log', 'shift_session', 'oee_daily',
 'app_user', 'device_terminal', 'correction_request', 'audit_log', 'kpi_target',
 'role_definition', 'operator_credential', 'auth_session', 'shift_handover',
 'oee_config', 'oee_validation_entry', 'sync_event'
 ];
BEGIN
 FOREACH target_table IN ARRAY tenant_scoped_tables LOOP
 IF to_regclass('public.' || target_table) IS NULL THEN
 CONTINUE;
 END IF;

 EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', target_table);
 EXECUTE format(
 'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true))'
 || ' WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
 target_table
 );

 -- Table owners bypass RLS by default; force it so an application
 -- connecting as the owner is still confined to its tenant.
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target_table);
 END LOOP;
END
$$;

-- `tenant` itself is the one table keyed by `id` rather than `tenant_id`.
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant;
CREATE POLICY tenant_isolation ON tenant
 USING (id = current_setting('app.tenant_id', true))
 WITH CHECK (id = current_setting('app.tenant_id', true));

-- `role_permission` inherits its tenancy through its role.
ALTER TABLE role_permission ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON role_permission;
CREATE POLICY tenant_isolation ON role_permission
 USING (
 EXISTS (
 SELECT 1 FROM role_definition r
 WHERE r.id = role_permission.role_id
 AND r.tenant_id = current_setting('app.tenant_id', true)
 )
 );
