-- ============================================================================
-- 034  Let the queue runner and the outbox relay see the rows they drain
-- ============================================================================
--
-- `planning_job` and `outbox_event` carry FORCE ROW LEVEL SECURITY with one
-- policy: a row is visible when `app.tenant_id` equals its tenant. That is
-- right for every request, and wrong for the two processes that drain the
-- tables. The job runner's claim runs *without* a tenant on purpose — it
-- cannot declare whose job is next before reading one (packages/job-queue,
-- `claim()`), and the outbox relay asks "which tenants have something
-- pending?" the same way. Under the tenant policy alone both queries return
-- nothing, silently: no error, no log line, every job PENDING forever.
--
-- Production on 2026-09-13: two planning jobs PENDING since 1 September and
-- not one SUCCEEDED ever. The console showed "Menghitung…" until the
-- planner gave up.
--
-- This adds a second, permissive policy: a session that has declared *no*
-- tenant may see and update these two tables. Policies are OR'ed, so a
-- session that has declared a tenant is unchanged — it still sees exactly its
-- own rows — and the handler that runs a claimed job still declares the
-- job's tenant before touching anything else (§22.4). What is admitted is
-- the runner and the relay, which is what the tables exist for.
--
-- `current_setting(..., true)` is NULL for a setting never touched and '' for
-- one whose transaction-local value has expired; both mean "no tenant".

DROP POLICY IF EXISTS runner_without_tenant ON planning_job;
CREATE POLICY runner_without_tenant ON planning_job
  USING (COALESCE(current_setting('app.tenant_id', true), '') = '')
  WITH CHECK (COALESCE(current_setting('app.tenant_id', true), '') = '');

DROP POLICY IF EXISTS runner_without_tenant ON outbox_event;
CREATE POLICY runner_without_tenant ON outbox_event
  USING (COALESCE(current_setting('app.tenant_id', true), '') = '')
  WITH CHECK (COALESCE(current_setting('app.tenant_id', true), '') = '');
