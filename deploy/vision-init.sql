-- Vision worker database: its own role and its own database on the Factory
-- Vision PostgreSQL server. Run by the `vision-init` service as POSTGRES_USER
-- on every `up` with the vision profile, so every statement is idempotent.
--
-- A separate database, not a schema inside factory_vision: the worker has no
-- tenant and no RLS, and the MES migrations and their append-only guarantees
-- stay exactly as they are. psql variable :pw carries VISION_DB_PASSWORD.

SELECT 'CREATE ROLE fv_vision LOGIN'
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fv_vision')\gexec

ALTER ROLE fv_vision LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'pw';

SELECT 'CREATE DATABASE fv_vision OWNER fv_vision'
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'fv_vision')\gexec

-- Nobody else connects to it; in particular not the MES application role.
REVOKE ALL ON DATABASE fv_vision FROM PUBLIC;
GRANT CONNECT ON DATABASE fv_vision TO fv_vision;
