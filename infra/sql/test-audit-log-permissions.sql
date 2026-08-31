-- Proves, at the PostgreSQL level, that the app_runtime role can INSERT and
-- SELECT on audit_logs but is DENIED UPDATE and DELETE. Run this connected
-- AS app_runtime (not as postgres, not as app_migrator):
--
--   psql -h localhost -U app_runtime -d agileworks_erp -f infra/sql/test-audit-log-permissions.sql
--
-- Each statement below auto-commits independently (psql's default), so a
-- permission error on TEST 3 does not prevent TEST 4 from running.

\set ON_ERROR_STOP off
\pset pager off

\echo '=== TEST 1: INSERT into audit_logs — expected: INSERT 0 1 (succeeds) ==='
INSERT INTO audit_logs (id, actor_type, action, entity_type, entity_id, created_at)
VALUES (gen_random_uuid(), 'SYSTEM', 'infra_verification_test', 'infra_test', 'db-permission-check', now());

\echo ''
\echo '=== TEST 2: SELECT from audit_logs — expected: 1 row returned (succeeds) ==='
SELECT id, actor_type, action, entity_type, created_at
FROM audit_logs
WHERE action = 'infra_verification_test'
ORDER BY created_at DESC
LIMIT 1;

\echo ''
\echo '=== TEST 3: UPDATE audit_logs — expected: ERROR: permission denied for table audit_logs ==='
UPDATE audit_logs SET reason = 'tampered' WHERE action = 'infra_verification_test';

\echo ''
\echo '=== TEST 4: DELETE FROM audit_logs — expected: ERROR: permission denied for table audit_logs ==='
DELETE FROM audit_logs WHERE action = 'infra_verification_test';

\echo ''
\echo '=== Result: TEST 1 and TEST 2 must succeed. TEST 3 and TEST 4 MUST show "permission denied for table audit_logs". ==='
\echo '=== If TEST 3 or TEST 4 succeed instead of erroring, the app_runtime grants in provision-roles.sql were not applied correctly — STOP and report this. ==='
