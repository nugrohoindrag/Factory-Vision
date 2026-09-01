-- Rollback 020 — Sync Conflict & Exception Reporting (MES-082).
--
-- Dropping this table discards every unresolved sync exception, which is the
-- record of production the shop floor captured and the server refused. There is
-- nowhere else to restore it from, so a rollback is only appropriate when the
-- feature is being removed, not when it is being repaired.
DROP TABLE IF EXISTS sync_exception;
