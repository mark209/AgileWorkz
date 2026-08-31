-- AgileWorks HVAC ERP — database role provisioning, PRE-MIGRATION (Phase 1).
--
-- Run this ONCE against a fresh database, as a superuser (e.g. the default
-- `postgres` role), BEFORE running `prisma migrate deploy`. Creates both
-- roles and grants that don't depend on any table existing yet. Not part of
-- the Prisma migration history on purpose: it creates roles with passwords,
-- and migration files get committed to source control — credentials never
-- should.
--
-- Table-level grants for app_runtime (SELECT/INSERT/UPDATE/DELETE on the
-- Phase 1 tables, and the audit_logs append-only restriction) live in
-- grant-runtime-privileges.sql instead, and run AFTER migration — those
-- grants reference tables that don't exist until the migration creates them.
--
-- This script takes no psql -v variables (see the PowerShell procedure for
-- why) — the caller substitutes the three passwords into the SQL text
-- before piping it in.

-- 1. Migration role — full DDL rights, used only at deploy time by
--    `prisma migrate deploy`. The running application NEVER connects as this role.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_migrator') THEN
    CREATE ROLE app_migrator LOGIN PASSWORD '__MIGRATOR_PASSWORD__';
  END IF;
END
$$;
GRANT ALL PRIVILEGES ON DATABASE agileworks_erp TO app_migrator;
GRANT ALL PRIVILEGES ON SCHEMA public TO app_migrator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO app_migrator;

-- 2. Runtime role — what the NestJS app actually connects as day to day.
--    Least-privilege: DML only, and deliberately NOT the same role that ran
--    the migrations, so a compromised app credential can't alter schema.
--    Only schema-level grants here (CONNECT/USAGE need no tables to exist).
--    Table-level grants are in grant-runtime-privileges.sql, post-migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime LOGIN PASSWORD '__RUNTIME_PASSWORD__';
  END IF;
END
$$;
GRANT CONNECT ON DATABASE agileworks_erp TO app_runtime;
GRANT USAGE ON SCHEMA public TO app_runtime;

-- 3. OCR/AI extraction worker role — Phase 5 Step 1. Distinct from both
--    app_migrator and app_runtime, per the Phase 1 policy record
--    (docs/architecture/ocr-worker-db-isolation.md), executed now that the
--    six extraction_* tables actually exist. The extraction worker process
--    (whatever runs the OCR/AI provider integration, Step 3) connects using
--    ONLY this credential, read from its own environment variable — never
--    the app_runtime credential, and app_runtime never uses this one either.
--    Only schema-level grants here (CONNECT/USAGE need no tables to exist,
--    same reasoning as app_runtime above). Table-level grants — SELECT,
--    INSERT, UPDATE on exactly the six extraction_* tables, and explicitly
--    NO grant of any kind on any service_report_* canonical table or
--    anything else in the schema — are in grant-runtime-privileges.sql,
--    post-migration, same split as app_runtime's own grants.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ocr_worker') THEN
    CREATE ROLE ocr_worker LOGIN PASSWORD '__OCR_WORKER_PASSWORD__';
  END IF;
END
$$;
GRANT CONNECT ON DATABASE agileworks_erp TO ocr_worker;
GRANT USAGE ON SCHEMA public TO ocr_worker;
