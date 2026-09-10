# Off-Platform Backup — Design Review

**Status: DESIGN REVIEW ONLY.** No Render resource created, no Cloudflare
resource created, no database role created, no secret generated, no
production change. This reviews the proposed recurring off-platform backup
for the private pilot before anything is provisioned. Awaiting approval.

Complements — does not replace — Render's native protection (PITR + 7-day
daily logical backups), which stays exactly as configured.

---

## 1. What this adds over Render's native backups

| Native (already active, unchanged) | This job adds |
|---|---|
| Point-in-time recovery, 3-day window | Retention to 90 days |
| Daily logical backups, 7-day retention | An **off-Render** copy (survives a Render account/region incident) |
| All on Render's infrastructure | Stored in Cloudflare R2, isolated credentials |

---

## 2. Database credential — dedicated read-only role, **not** `DATABASE_URL`

**Recommendation: create a dedicated `app_backup` role. Do not use the
application's `DATABASE_URL`.**

- The app's `DATABASE_URL` authenticates as `app_runtime`, which holds
  `INSERT`/`UPDATE`/`DELETE` on business tables. A backup job needs none of
  that — only `CONNECT`, schema `USAGE`, and `SELECT`. Giving a second
  service full DML credentials (and storing them in a second place) widens
  the exposure surface of the most dangerous credential for zero benefit.
- `pg_dump` requires exactly: `CONNECT` on the database, `USAGE` on
  schemas, `SELECT` on every table and sequence. A role scoped to precisely
  that is the correct least-privilege fit and **cannot modify the database
  even if the backup script is wrong**.
- It also makes backup activity independently identifiable in
  `pg_stat_activity` and independently revocable (rotate/disable
  `app_backup` without touching the app).
- This matches the project's established pattern —
  [`infra/sql/provision-roles.sql`](../../infra/sql/provision-roles.sql)
  already provisions `app_migrator` (DDL), `app_runtime` (DML), `ocr_worker`
  (scoped DML) out-of-band via SQL, not migrations. `app_backup` (global
  `SELECT`) is the natural fourth.

**Prerequisite (a production change — requires its own approval, not done
in this review):** run once against production, as the Render-provided
database user:

```sql
CREATE ROLE app_backup LOGIN PASSWORD '__GENERATED_AT_RUN_TIME__';
GRANT CONNECT ON DATABASE agileworks_erp TO app_backup;
GRANT USAGE ON SCHEMA public TO app_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO app_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO app_backup;
```

`ALTER DEFAULT PRIVILEGES` ensures tables added by future migrations are
covered automatically. The password is generated at run time and entered
directly into the Cron Job's secret store — never shown in chat, never
committed.

**Fallback if role creation is blocked on Render's managed instance**
(Render's default DB user can normally `CREATE ROLE`, so this should
work): use `DATABASE_URL` with the explicit understanding that it is
over-privileged for the task. Recommended against.

---

## 3. Architecture

```
Render Cron Job  (Docker image: postgres:18-alpine + rclone)
schedule: 0 18 * * 6  UTC   ==  Sunday 02:00 Asia/Manila   (Manila = UTC+8, no DST)
  │
  │  set -euo pipefail ; never set -x
  │
  ├─ pg_dump -Fd                                        [read-only]
  │     connection via libpq env vars (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE)
  │     → NO secret on argv, nothing to leak via `ps`
  │     → role: app_backup (SELECT only)
  │     → target: Render Postgres production            [UNCHANGED — pg_dump takes
  │                                                      ACCESS SHARE locks only,
  │                                                      no DDL, no DML]
  │
  ├─ tar czf /tmp/agileworks_erp_<UTC-ts>.dir.tar.gz -C /tmp <dumpdir>
  │     <UTC-ts> = date -u +%Y-%m-%dT%H-%M-%SZ   → unique per run, colon-free
  │
  ├─ rclone copy /tmp/agileworks_erp_<ts>.dir.tar.gz  r2:agileworks-erp-backups/pg/
  │     rclone config entirely from RCLONE_CONFIG_* env vars
  │     → NO secret on argv
  │     → -q (quiet), no -v : nothing sensitive to stdout/stderr
  │
  ├─ VERIFY: rclone lsjson r2:agileworks-erp-backups/pg/agileworks_erp_<ts>.dir.tar.gz
  │          → object exists AND size > 0 ?   else  exit 1
  │
  ├─ rm -rf /tmp/agileworks_erp_<ts>*          [success path only]
  │
  └─ curl -fsS --retry 3 "$HEARTBEAT_URL"      [dead-man's-switch ping, success only]

R2 bucket  agileworks-erp-backups   (private, separate from agileworks-erp-documents)
  └─ lifecycle rule: expire objects older than 90 days      [retention mechanism]

Alerting:
  1. Render workspace notification on failed Cron Job run   [primary]
  2. External cron monitor (healthchecks.io / Better Stack free tier):
     alerts if no heartbeat received within 8 days          [complement — catches
                                                             "job never ran at all"]
```

### How each stated requirement is met

| Requirement | How |
|---|---|
| PG18-compatible `pg_dump` | Docker image `postgres:18-alpine` → `pg_dump` 18.x, exact match to production |
| Weekly, Asia/Manila | Cron `0 18 * * 6` UTC = Sun 02:00 Manila (UTC+8, no DST — fixed offset) |
| Compressed directory-format | `pg_dump -Fd` then `tar czf` → same `.dir.tar.gz` shape as Render's own export |
| Dedicated R2 backup location | Separate bucket `agileworks-erp-backups`, `pg/` key prefix |
| 90-day retention | R2 bucket lifecycle rule (age-based expiry) — the job never deletes |
| Unique timestamped names | Key `pg/agileworks_erp_<UTC ISO seconds>.dir.tar.gz`; weekly cadence → collision impossible |
| Least-privilege R2 creds | New API token scoped to **only** `agileworks-erp-backups`, Object Read & Write (R2 has no write-only preset). Existing documents-bucket token not reused, not modified. |
| Creds never in logs | libpq + `RCLONE_CONFIG_*` env vars only — nothing on argv; `set -x` never enabled; `pg_dump`/`rclone` run non-verbose |
| No secrets in Git | Repo holds only `infra/backup/Dockerfile` + `backup.sh` — env-var *references* only. All values entered on the Render Cron Job service. |
| Failure → non-zero exit | `set -euo pipefail`; every step aborts the script on error; Render marks the run failed on non-zero exit |
| Upload failure ≠ success | Order is dump → tar → upload → **verify remote object** → cleanup → exit 0. A failed upload aborts (non-zero) before cleanup and before exit 0. "Success" requires the verified-upload step to pass. |
| Temp files deleted after upload | `rm -rf /tmp/agileworks_erp_<ts>*` on the success path; the Cron Job container is torn down after every run regardless |
| Detect/alert on failed scheduled backups | Render failure notification (primary) + external dead-man's-switch heartbeat (complement) |
| Preserve Render backup/recovery config | Purely additive — only `pg_dump` (read) + R2 `PUT`. No Render API calls, no change to PITR/retention/DB settings. |
| Do not modify production DB | `pg_dump` is read-only; `app_backup` role cannot write even if the script were wrong |

---

## 4. Exact Render resource required

**One Render Cron Job**, Docker runtime, built from `infra/backup/Dockerfile`
in this repo (`FROM postgres:18-alpine` + `apk add --no-cache rclone` +
`COPY backup.sh`). Smallest instance size — Cron Jobs bill per-second of
run time, not as a persistent instance.

*(If Render does not support Docker-runtime Cron Jobs on the current plan —
expected to be supported, to be confirmed at creation — the fallback is a
native job that `apk add`s `rclone` at run time, adding ~5 s and a per-run
dependency on Alpine's package CDN. Docker image is cleaner and preferred.)*

### Files added to Git (reviewed, no secrets)
- `infra/backup/Dockerfile` (~4 lines)
- `infra/backup/backup.sh` (the script above, fully env-driven)
- `infra/backup/README.md` (required env vars + restore procedure)

### Env vars / secrets set on the Cron Job service (entered in Render, never Git)
| Name | Secret? | Source |
|---|---|---|
| `PGHOST`, `PGPORT`, `PGDATABASE` | no | Render Postgres internal connection info |
| `PGUSER` | no | `app_backup` |
| `PGPASSWORD` | **yes** | `app_backup` password (generated when the role is created) |
| `RCLONE_CONFIG_R2_TYPE` = `s3`, `..._PROVIDER` = `Cloudflare`, `..._ENDPOINT`, `..._REGION` = `auto` | no | Cloudflare R2 |
| `RCLONE_CONFIG_R2_ACCESS_KEY_ID` | **yes** | new backups-scoped R2 token |
| `RCLONE_CONFIG_R2_SECRET_ACCESS_KEY` | **yes** | new backups-scoped R2 token |
| `R2_BUCKET` = `agileworks-erp-backups` | no | — |
| `HEARTBEAT_URL` | **yes** (capability URL) | external cron monitor |

---

## 5. Estimated monthly cost

| Item | Cost |
|---|---|
| Render Cron Job | Billed per-second at the small-instance rate; a weekly ~30–60 s run ≈ **a few cents/month**, and paid workspaces include a monthly cron/job-minutes allowance this sits inside. **Confirm against Render's current Cron Job pricing before creating.** |
| R2 storage | ~52 weekly objects × current dump size (tens of KB today, low MB even with real pilot data) → **$0** (inside R2's 10 GB free allowance for a long time) |
| R2 operations | ~52 `PUT` + a few `LIST` per month → **$0** (inside free tier) |
| R2 egress (only on restore) | **$0** — R2 has no egress fee |
| External cron monitor | **$0** — healthchecks.io / Better Stack free tier covers one weekly check |
| **Total additional** | **effectively < $1/month** |

---

## 6. R2 permissions

| | |
|---|---|
| New bucket | `agileworks-erp-backups` — **separate** from `agileworks-erp-documents` |
| Public access | disabled (private) |
| New API token | scoped to **only** `agileworks-erp-backups`; permission **Object Read & Write** (needed: `PutObject` to upload, `HeadObject`/`ListObjects` to verify; R2 has no write-only preset) |
| Existing documents-bucket token | untouched, not reused — a compromise of the backup token cannot reach user documents, and vice versa |
| Blast radius | backup token can add/read/overwrite objects in the backups bucket only; **cannot delete across the 90-day boundary** because deletion is done by R2's lifecycle rule, not the token |

> Your requirement wording said "backup **prefix**". A `backups/` prefix
> inside the existing `agileworks-erp-documents` bucket is viable and uses
> one fewer resource, but then the backup job's token would have write
> access to the whole documents bucket (R2 object-prefix-scoped tokens
> exist but are newer/less battle-tested than bucket scoping). **A
> separate bucket gives materially stronger credential isolation for no
> extra cost** — recommended. Final call is yours.

---

## 7. Retention mechanism

Cloudflare R2 **object lifecycle policy** on `agileworks-erp-backups`:
"delete objects older than 90 days." Configured once (Cloudflare dashboard
or API), no code. The backup job only ever writes; R2 expires old objects
on its own (runs roughly daily, so effective retention is 90 days ± ~1
day). Retention holds even though the job's credentials cannot themselves
delete anything.

---

## 8. Restore procedure (from an R2 backup)

Identical to the C1–C3 procedure just validated against a real Render
export, so already proven:

1. **Locate**: list `agileworks-erp-backups/pg/` (Cloudflare dashboard or
   `rclone lsf r2:agileworks-erp-backups/pg/`), pick the timestamped
   `agileworks_erp_<ts>.dir.tar.gz`.
2. **Download** (R2 egress free).
3. **Extract**: `tar xzf agileworks_erp_<ts>.dir.tar.gz` → directory-format
   dump directory.
4. **Restore** into the target — a fresh Render Postgres instance for real
   recovery, or a local `postgres:18` for a test:
   ```
   pg_restore -Fd --no-owner --no-privileges -d <target_db> <dump_dir>
   ```
   (`--single-transaction` for an all-or-nothing test restore.)
5. **Re-apply roles/grants** from
   [`infra/sql/provision-roles.sql`](../../infra/sql/provision-roles.sql)
   and `grant-runtime-privileges.sql` — deliberately not in the dump.
6. **Repoint** the app's `DATABASE_URL` (and `OCR_WORKER_DATABASE_URL`) at
   the restored instance.

A restore-test of an R2 backup should be run once after the job's first
successful upload, using the same throwaway-container method as C1–C3.

---

## 9. Prerequisites requiring explicit approval (each is a real change — none done in this review)

1. **Production DB**: `CREATE ROLE app_backup` + the `GRANT`/`ALTER DEFAULT
   PRIVILEGES` block in §2.
2. **Cloudflare**: create bucket `agileworks-erp-backups` (private) + a
   backups-scoped API token + the 90-day lifecycle rule.
3. **External**: a free cron-monitor account for the heartbeat URL.
4. **Git**: commit `infra/backup/{Dockerfile,backup.sh,README.md}` (no
   secrets).
5. **Render**: create the Docker Cron Job + set the §4 env vars +
   configure the failed-run notification.

---

## Not changed by this design

- Render PITR / automatic daily backups / retention windows — untouched.
- Production database schema, data, and existing roles — untouched.
- The `agileworks-erp-documents` bucket and its token — untouched.
- Application code and the three running services — untouched.
