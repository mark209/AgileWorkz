# Off-platform PostgreSQL backup — Render Cron Job

**Draft for review — not yet committed, not yet deployed.** See
[`docs/architecture/phase7-p0-offplatform-backup-design.md`](../../docs/architecture/phase7-p0-offplatform-backup-design.md)
for the full design review and rationale behind every decision below.

This job complements — never replaces — Render's own native PostgreSQL
protection (point-in-time recovery and daily logical backups), which stays
exactly as configured. It adds two things Render's native backups don't:
retention beyond 7 days, and a copy stored off Render entirely.

## What it does

Once a week, this job:
1. Runs `pg_dump --format=directory` against production, authenticated as
   the dedicated, read-only `app_backup` role (never the application's own
   `DATABASE_URL`/`app_runtime` credential).
2. Compresses the dump into one `.dir.tar.gz` archive.
3. Uploads it to a private, dedicated Cloudflare R2 bucket
   (`agileworks-erp-backups`, under the `pg/` prefix) — a different bucket
   and a different, separately-scoped API token than the one the
   application itself uses for Service Report documents.
4. Independently verifies the uploaded object exists with a non-zero size
   before considering the run successful.
5. Deletes its own local temp files.
6. Pings an external heartbeat monitor (a dead-man's-switch) — only after
   the backup is verified.

Retention is enforced by an R2 bucket lifecycle rule (objects older than 90
days are deleted automatically) — this job never deletes anything itself.

## Required environment variables (set on the Render Cron Job — never in Git)

| Variable | Secret? | Value / source |
|---|---|---|
| `PGHOST` | no | The Render Postgres instance's internal host |
| `PGPORT` | no | Typically `5432` |
| `PGDATABASE` | no | `agileworks_erp` |
| `PGUSER` | no | `app_backup` |
| `PGPASSWORD` | **yes** | `app_backup`'s password — set once, when this Cron Job is created (see "First-time setup" below) |
| `R2_BUCKET` | no | `agileworks-erp-backups` |
| `RCLONE_CONFIG_R2_TYPE` | no | `s3` |
| `RCLONE_CONFIG_R2_PROVIDER` | no | `Cloudflare` |
| `RCLONE_CONFIG_R2_ENDPOINT` | no | This R2 account's S3-compatible endpoint URL |
| `RCLONE_CONFIG_R2_REGION` | no | `auto` |
| `RCLONE_CONFIG_R2_ACCESS_KEY_ID` | **yes** | The `agileworks-erp-r2-backup` token's Access Key ID (scoped to only the `agileworks-erp-backups` bucket) |
| `RCLONE_CONFIG_R2_SECRET_ACCESS_KEY` | **yes** | That same token's Secret Access Key |
| `HEARTBEAT_URL` | **yes** (capability URL) | The healthchecks.io ping URL for the `agileworks-erp-backup` check |

**Every value above is set directly in Render's environment-variable
store, never committed, never displayed in chat.** This repository holds
only the two files that read these variable *names* — `Dockerfile` and
`backup.sh` — never a value.

## Schedule

```
0 18 * * 6
```
In UTC — Render Cron Jobs schedule in UTC. This is **Saturday 18:00 UTC =
Sunday 02:00 Asia/Manila** (Manila is a fixed UTC+8, no daylight saving, so
this offset never needs adjusting). The healthchecks.io monitor is
configured with the identical schedule and a 1-hour grace period.

## First-time setup (not done yet — for the actual Cron Job creation step)

1. The `app_backup` role already exists in production, created and
   verified in prerequisite #1 — but it has **no password yet**, so it
   cannot connect. When this Cron Job is created on Render, generate a
   password for it there and, in the same sitting, set it on the role:
   ```sql
   ALTER ROLE app_backup PASSWORD '<value generated in Render's secret store>';
   ```
   The password is generated and used entirely within Render's own
   environment-variable UI and this one `ALTER ROLE` statement — it is
   never pasted into any chat.
2. Set every environment variable in the table above on the Cron Job
   service.
3. Trigger one manual run and confirm: the job logs `Backup complete: ...`,
   a new object appears under `agileworks-erp-backups/pg/` in the
   Cloudflare dashboard, and a "success" ping registers on the
   healthchecks.io check.
4. Perform one restore test of that first real backup, using the same
   throwaway-container method already validated in prerequisites leading
   up to this one (extract → `pg_restore -Fd --no-owner --no-privileges`
   into a disposable PostgreSQL 18 instance → compare row counts/hashes).

## Restore procedure

**⚠ Never perform a restore test against the production database or any
database currently used by the application. Always restore-test into a
fresh, disposable, or otherwise isolated target** — the same
throwaway-container method already validated in the prerequisites leading
up to this job.

1. **Locate** the backup: Cloudflare dashboard → `agileworks-erp-backups`
   → `pg/` → pick the timestamped `agileworks_erp_<UTC-timestamp>.dir.tar.gz`
   you want (or `rclone lsf r2:agileworks-erp-backups/pg/` if you have
   rclone configured locally).
2. **Download** it (R2 has no egress fee).
3. **Extract**:
   ```bash
   tar xzf agileworks_erp_<timestamp>.dir.tar.gz
   ```
4. **Restore** into the target — a fresh Render Postgres instance for a
   real recovery, or a disposable local `postgres:18` container to test
   the backup itself:
   ```bash
   pg_restore -Fd --no-owner --no-privileges -d <target_database> agileworks_erp_<timestamp>
   ```
   Add `--single-transaction` for an all-or-nothing test restore.
5. **Re-apply roles and grants** — deliberately not included in the dump
   by design:
   [`infra/sql/provision-roles.sql`](../sql/provision-roles.sql) and
   [`infra/sql/grant-runtime-privileges.sql`](../sql/grant-runtime-privileges.sql).
6. **Repoint** the application's `DATABASE_URL` and
   `OCR_WORKER_DATABASE_URL` at the restored instance, if this is a real
   recovery rather than a test.

## Alerting — how a failed or missed backup is detected

Two independent mechanisms, deliberately not relying on either one alone:

1. **Render's own failed-run notification** — configured on the Cron Job
   service, fires whenever the script exits non-zero (a failed `pg_dump`,
   a failed upload, a failed verification, or — logged distinctly — a
   successful backup whose heartbeat ping itself failed to deliver).
2. **healthchecks.io's overdue-check alert** — fires if no successful ping
   arrives within the grace period, which also catches the case Render's
   own notification can't: the job never running at all (e.g. the Cron
   Job's schedule was accidentally disabled, or Render itself had an
   outage).

## Security notes

- `app_backup` can only `SELECT` — verified via PostgreSQL's own catalog
  privilege functions (`has_table_privilege`, etc.) against all tables,
  confirmed unable to `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`/`CREATE`/
  `ALTER`/`DROP` anything, and confirmed to hold no sequence, superuser,
  createdb, createrole, replication, or RLS-bypass capability.
- The R2 token used here is scoped to only the `agileworks-erp-backups`
  bucket — it cannot read, write, or delete anything in the application's
  own `agileworks-erp-documents` bucket, and vice versa.
- No credential (Postgres, R2, or the heartbeat URL) is ever passed as a
  command-line argument to any tool in `backup.sh` — each is consumed via
  environment variables the relevant tool reads natively, so none of them
  appear in `ps` output during a run.
- This job never modifies production data or schema. `pg_dump` takes only
  `ACCESS SHARE` locks.
