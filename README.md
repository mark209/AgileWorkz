# AgileWorks HVAC ERP

For the Supabase database and owner's Render account migration, see
[the cutover runbook](docs/architecture/supabase-render-cutover.md).

Custom HVAC service management ERP for AgileWorks Solutions OPC. This repo
currently contains **Phase 1 only** — the platform foundation (auth, RBAC,
audit log, system settings) — per the approved Rev 7 architecture blueprint.
Customers, Sites, Work Orders, Quotations, and the entire Service Report
intake/verification pipeline are **not yet built**; they land in Phases 2–5.

## Stack

PostgreSQL · Prisma · NestJS (TypeScript) · Next.js (office web app) ·
Next.js PWA shell (technician field app) · Redis / BullMQ · S3-compatible
object storage (local-disk adapter in dev) · pnpm workspaces.

## Prerequisites

- Node.js 20+
- pnpm (`npm install -g pnpm` if you don't have it)
- Docker + Docker Compose (for local Postgres/Redis/MinIO) — **or** your own
  local Postgres 16+, Redis 7+, and an S3-compatible endpoint

## First-time setup

```bash
pnpm install

# 1. Start local infrastructure
docker compose -f infra/docker-compose.yml up -d

# 2. Copy env and fill in real values (never commit .env)
cp .env.example .env
#   - set JWT_ACCESS_SECRET / JWT_REFRESH_SECRET to long random strings
#   - set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD for your first login
#   - set the DB passwords to match what you use in step 3

# 3. Create the two database roles (run once, as the postgres superuser).
#    This step only creates roles + schema-level grants — no table exists
#    yet, so no table-level GRANT belongs here. Substitute your two chosen
#    passwords into the SQL text yourself (see infra/sql/provision-roles.sql's
#    header comment) rather than relying on psql -v substitution, which is
#    unreliable when piped through some non-interactive invocations.
#    put those same two passwords into DATABASE_URL / MIGRATE_DATABASE_URL in .env

# 4. Apply migrations (as the migration role) — this creates the tables —
#    and generate the Prisma Client. The schema's datasource always reads
#    DATABASE_URL (app_runtime, no DDL rights, correctly has zero grants on
#    _prisma_migrations) — so the migrator URL must be substituted in for
#    this one command only, never written into .env itself.
#
#    Bash / macOS / Linux:
DATABASE_URL="$MIGRATE_DATABASE_URL" pnpm prisma:migrate:deploy
#
#    Windows PowerShell (save/restore so the override doesn't leak into any
#    later command in the same terminal — e.g. don't let a dev server you
#    start afterward in this same window inherit app_migrator by accident):
#      $prevDatabaseUrl = $env:DATABASE_URL
#      $env:DATABASE_URL = $env:MIGRATE_DATABASE_URL
#      pnpm prisma:migrate:deploy
#      $env:DATABASE_URL = $prevDatabaseUrl
pnpm prisma:generate

# 5. NOW grant app_runtime its table-level privileges (the tables exist now).
#    Connect as app_migrator or postgres; see infra/sql/grant-runtime-privileges.sql

# 6. Seed roles, Phase 1 permissions, system settings, and the bootstrap admin
pnpm prisma:seed

# 6. Run everything
pnpm dev:api    # http://localhost:3001
pnpm dev:web    # http://localhost:3000 — office app
pnpm dev:field  # http://localhost:3002 — technician PWA shell
```

Log in at `http://localhost:3000/login` with `SEED_ADMIN_EMAIL` /
`SEED_ADMIN_PASSWORD`.

## Why two database roles

The running API never connects with the same credential that ran the
migrations. `app_migrator` (DDL, deploy-time only) and `app_runtime` (what
the app actually uses) are separate Postgres roles. Provisioning is split
into two files because it's split into two points in time: `provision-roles.sql`
creates both roles pre-migration (no table dependency), and
`grant-runtime-privileges.sql` grants `app_runtime` its actual table access
post-migration, once the tables it references exist. `app_runtime` has no
`UPDATE`/`DELETE` grant on `audit_logs`: append-only is a database
guarantee, not just application discipline. A third role, `ocr_worker`, is
documented but **not provisioned** — see
`docs/architecture/ocr-worker-db-isolation.md` — it's created when the
Service Report extraction tables land in a later phase.

## Repository layout

```
apps/
  web/     office app (Next.js) — login + role/permission dashboard shell
  field/   technician PWA shell (Next.js) — login only this phase
  api/     NestJS backend — the actual Phase 1 build
    src/modules/identity/   users, user_roles, roles, permissions, auth
    src/modules/settings/   system_settings
    src/modules/audit/      append-only audit log
    src/common/storage/     StorageProvider interface + local-disk adapter
    src/common/extraction/  ExtractionProvider interface + stub (no OCR/AI vendor yet)
    src/common/queue/       BullMQ wiring + a health-check job
packages/
  shared-types/   DTOs and enums shared by api, web, field
  config/         shared tsconfig/eslint base
prisma/
  schema.prisma   the Phase 1 schema (7 tables)
  migrations/      generated migration SQL
  seed.ts         roles, Phase 1 permissions, system settings, bootstrap admin
infra/
  docker-compose.yml                  local postgres/redis/minio
  sql/provision-roles.sql             role creation — pre-migration
  sql/grant-runtime-privileges.sql    app_runtime table grants — post-migration
  sql/test-audit-log-permissions.sql  proves audit_logs append-only at the DB level
docs/architecture/         Rev 7 blueprint, Phase 1 plan, OCR isolation policy
```

## Running checks

```bash
pnpm lint
pnpm typecheck
pnpm test                 # unit tests — no live DB/Redis required
```

Integration/E2E tests that need a live database, Redis, or the DB-grant
enforcement test for `audit_logs` require Docker (or equivalent local
services) and are not run automatically in every environment — see the
Phase 1 completion report for exactly what was and wasn't executed in this
build.

## What's next

See `docs/architecture/` for the full Rev 7 blueprint and the Phase 1 plan.
Phase 2 (Customer Data: customers, contacts, sites, assets) is scoped but
not started.
