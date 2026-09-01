-- Rollback 008 Mold Compatibility
ALTER TABLE work_order DROP CONSTRAINT IF EXISTS fk_work_order_mold;
ALTER TABLE production_batch DROP CONSTRAINT IF EXISTS fk_prod_batch_mold;
DROP TABLE IF EXISTS product_mold_compatibility CASCADE;
DROP TABLE IF EXISTS mold CASCADE;
