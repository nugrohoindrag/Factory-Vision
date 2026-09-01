-- Rollback 021 — removes the machine and mould exclusivity indexes.
--
-- Dropping these lets two Work Orders run on one machine again, which is the
-- race Architecture section 891 exists to close. Roll back only to unblock a
-- deployment, and put it back.
DROP INDEX IF EXISTS uq_work_order_machine_in_production;
DROP INDEX IF EXISTS uq_work_order_mold_in_production;
