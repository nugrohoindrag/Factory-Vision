-- Rollback 006 Customer Demand
DROP TABLE IF EXISTS customer_order_line CASCADE;
DROP TABLE IF EXISTS customer_order CASCADE;
DROP TABLE IF EXISTS customer CASCADE;
