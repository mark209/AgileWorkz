-- Review before running against the AgileWorks Supabase project.
-- The ERP uses direct PostgreSQL connections through Prisma, not the
-- Supabase Data API. Keep PostgreSQL credentials in server-side secrets.
-- Run as postgres after confirming the current database backup is restorable.

BEGIN;

-- Supabase's default public-schema grants currently include anon and
-- authenticated. Remove their access to existing and future ERP objects.
REVOKE ALL ON SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- A separate read-only role will be used by the replacement backup job.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_backup') THEN
    CREATE ROLE app_backup NOLOGIN;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA public TO app_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT ON TABLES TO app_backup;

-- RLS blocks Data API roles with no policy. Preserve the existing direct-SQL
-- access of app_runtime and ocr_worker; their table GRANTs remain the limit
-- on which commands they can issue. app_backup can only read rows.
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT c.oid, n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', target.schema_name, target.table_name);

    IF has_table_privilege('app_runtime', target.oid, 'SELECT') THEN
      EXECUTE format(
        'CREATE POLICY app_runtime_access ON %I.%I FOR ALL TO app_runtime USING (true) WITH CHECK (true)',
        target.schema_name, target.table_name
      );
    END IF;

    IF has_table_privilege('ocr_worker', target.oid, 'SELECT') THEN
      EXECUTE format(
        'CREATE POLICY ocr_worker_access ON %I.%I FOR ALL TO ocr_worker USING (true) WITH CHECK (true)',
        target.schema_name, target.table_name
      );
    END IF;

    EXECUTE format(
      'CREATE POLICY app_backup_read ON %I.%I FOR SELECT TO app_backup USING (true)',
      target.schema_name, target.table_name
    );
  END LOOP;
END
$$;

COMMIT;
