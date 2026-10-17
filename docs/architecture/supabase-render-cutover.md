# Supabase database and new Render deployment

The connected **HVAC ERP** Supabase project is the ERP's main PostgreSQL
database. Deploy the existing apps to the owner's Render account using this
database. Authentication, Redis/BullMQ, OCR, and S3-compatible document
storage retain their current application integrations.

## State observed on 2026-10-13

- The connected Supabase project is `qdmdyixboavskzqanfkt` (Tokyo, PostgreSQL 17).
- It already contains all 19 repository Prisma migrations, 52 public tables,
  one user, and business records. Treat it as populated, not a fresh target.
- `app_runtime` and `ocr_worker` exist and have table-scoped grants.
  `app_migrator` does not exist there. All tables are owned by `postgres`, so
  use a separate `postgres` administrative connection for migrations; never
  give it to the running API.
- The access correction in
  [`infra/sql/supabase-public-access.sql`](../../infra/sql/supabase-public-access.sql)
  was applied on 2026-10-13. All 52 public tables have RLS enabled; `anon`
  and `authenticated` have no table grants. The `app_runtime` and
  `ocr_worker` Prisma connections still read their permitted tables, and
  Supabase's security advisor returned no findings. `app_backup` now exists
  as `NOLOGIN` with read-only grants. The Supabase Data API is unused by the
  app; disabling it is a separate project setting.
- The previous Render database is inaccessible. Records that exist only there
  cannot be recovered by this deployment. Supabase is the available baseline.

## 1. Verify the Supabase baseline

1. Confirm the 19 applied Prisma migrations and representative business
   records in Supabase. Do not reset or reseed this populated project.
2. Make a restorable backup of Supabase before any further schema or data
   changes. The access correction was applied as one transaction and checked
   against both existing Prisma roles; a restore test remains to be done.
3. Document storage is separate from PostgreSQL. Confirm the new API can
   access the existing private R2 objects. A database backup does not include
   signed service-report files.

## 2. Supabase database access

- `DATABASE_URL`: `app_runtime` session-pooler connection (port 5432) for the
  NestJS API. Keep it server-side. Size Prisma connections to the project's
  actual pool limit before scaling API instances.
- `OCR_WORKER_DATABASE_URL`: the separate `ocr_worker` session-pooler
  connection used by extraction staging writes.
- `MIGRATE_DATABASE_URL`: an administrative connection, used only by Prisma
  Migrate through the repository's one-command `DATABASE_URL` override (see
  the root README). Since the tables are owned by `postgres`, use the Supabase
  `postgres` role for this connection.
  The Render API process must never use this value at runtime.
- Use TLS for all three connections. Get the actual connection strings from
  Supabase's **Connect** panel and store them as Render environment secrets;
  do not put credentials in Git or chat.
- Run `pnpm prisma:migrate:deploy` only after checking migration status.
  All 19 migrations were already marked applied in Supabase on the observation
  date.
- The access correction is already applied. Do not run the SQL file again;
  its policies are intentionally created once. A read-only backup role was
  provisioned without login and still needs a credential for the backup job.
- For every future Prisma migration that creates a public table, review its
  RLS policy and refresh the app/worker/backup grants before deploying code
  that uses it. Supabase's default grants are removed by the access script.

## 3. Create services in the owner's Render account

Connect the repository to the owner's Render account. Recreate the existing
three long-running services in Singapore, with manual deployment until the
cutover is verified. Use repository-root build commands because the apps share
the pnpm workspace and generated Prisma client.

| Service | Build command | Start command | Required configuration |
| --- | --- | --- | --- |
| API | `pnpm install --frozen-lockfile && pnpm prisma:generate && pnpm --filter @agileworks/api build` | `pnpm --filter @agileworks/api start:prod` | Database URLs, JWT secrets, Redis, private S3 storage, OCR, CORS origins, `TRUST_PROXY_HOPS=1` |
| Office web | `pnpm install --frozen-lockfile && pnpm --filter @agileworks/web build` | `pnpm --filter @agileworks/web start` | `NEXT_PUBLIC_API_BASE_URL` |
| Technician field | `pnpm install --frozen-lockfile && pnpm --filter @agileworks/field build` | `pnpm --filter @agileworks/field start` | `NEXT_PUBLIC_API_BASE_URL` |

Set each service's root directory to the repository root. Set the API health
check path to `/health` and confirm it reports database, queue, and storage
healthy. Set `WEB_APP_ORIGIN` and `FIELD_APP_ORIGIN` to the new public web and
field origins. `NEXT_PUBLIC_API_BASE_URL` is baked into each Next.js build,
so rebuild both frontends whenever the API origin changes. Check the new
service sizes against the prior deployment and the in-process OCR worker's
memory needs before choosing paid plans.

Keep the existing Redis and document-storage services unless their ownership
is being transferred separately. The API needs authenticated TLS Redis and
private S3-compatible storage; local disk is unsuitable for a new Render
deployment. The existing Vertex credential, if OCR is enabled, remains a
server-side secret file. Recheck the configured OCR model's availability
before testing extraction.

## 4. Backups and recovery

Recreate the weekly Render Cron Job from `infra/backup/` in the owner's account.
Point `PGHOST`, `PGPORT`, `PGDATABASE`, and `PGUSER` to Supabase's connection
details for the read-only `app_backup` role, with `PGSSLMODE=require`. Keep
the R2 backup bucket and heartbeat private. Verify one backup and one
isolated restore before relying on the new schedule. The backup Docker image
uses PostgreSQL 18 tools against the Supabase PostgreSQL 17 server.

## 5. Release checks

Run the repository's build, typecheck, and relevant tests. Then exercise the
five business journeys in the requirements handover with authorized test
users: customer/site reuse; quotation revision, approval and acceptance;
work-order scheduling and assignment; signed-report upload, uncertain OCR
and human verification; and customer/equipment history lookup. Include the
direct/reactive report path, role-denied closure, and retry-safe upload.

After the new services pass, direct users to the new origins and monitor
`/health`, logs, queue processing, storage access, and audit events. Preserve
the Supabase database and its backup throughout deployment.
