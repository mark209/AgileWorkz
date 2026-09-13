# Phase 7 P0 — Production Readiness Verification Record

**Status: VERIFICATION RECORD.** Architecture A has been provisioned for the
private pilot per the approved
[cost proposal](./phase7-p0-architecture-a-cost-proposal.md) and
[pre-provisioning gate review](./phase7-p0-pre-provisioning-gate-review.md).
This document records the state of every Phase 7 P0 requirement against the
**actual live production configuration** as of **2026-09-10**, with the
verification method for each. No production customer data has been entered.

Provisioning was performed interactively by the project owner (account
creation, plan selection, secret entry, DNS untouched); Claude guided each
step and performed read-only inspection and the code fix noted below.

---

## Live production topology

| Service | Provider · plan | Region | URL |
|---|---|---|---|
| `agileworks-erp-api` (NestJS API + in-process BullMQ worker) | Render Web Service, Standard (2 GB / 1 CPU) | Singapore | `https://agileworks-erp-api.onrender.com` |
| `agileworks-erp-web` (Next.js) | Render Web Service, Starter (512 MB / 0.5 CPU) | Singapore | `https://agileworks-erp-web.onrender.com` |
| `agileworks-erp-field` (Next.js) | Render Web Service, Starter (512 MB / 0.5 CPU) | Singapore | `https://agileworks-erp-field.onrender.com` |
| `agileworks-erp-postgres` | Render Postgres, Basic-1GB (0.5 CPU / 1 GB RAM / 15 GB storage) | Singapore | internal only |
| `agileworks-erp-redis` | Upstash Redis, Free (persistence + TLS on) | AWS ap-southeast-1 (Singapore) | authenticated `rediss://` only |
| `agileworks-erp-documents` | Cloudflare R2, pay-as-you-go | APAC location hint (best-effort) | private bucket, signed URLs only |
| OCR | Google Cloud Vertex AI, `gemini-2.5-flash` | `asia-southeast1` | outbound API call only |

All three Render Web Services have **Auto-Deploy: Off** — deploys are
manual-trigger only. Current deployed commit: to be confirmed against
`2af7fe3` (the `prisma/seed.ts` env-loading fix) at next manual deploy of
the API service.

---

## Phase 7 P0 requirement verification

| # | Requirement | Status | Verification method / evidence |
|---|---|---|---|
| 1 | Multer High-severity vulnerabilities eliminated | **PASS (in deployed code)** | `pnpm-workspace.yaml` override to `multer ^2.3.0`; `pnpm audit` showed all 5 multer advisories gone; committed `0f2d30f`. Ships in the deployed API image. |
| 2 | Server-side magic-byte upload content validation | **PASS (in deployed code)** | `file-signature.util.ts` + unit/e2e tests; committed `8cf6aeb`. Not yet exercised against a real production upload (see Open Items). |
| 3 | Redis authenticated + TLS + not publicly exposed | **PASS** | Upstash Free with TLS enabled; connection is `rediss://` with token auth — Upstash has no unauthenticated access mode. `parseRedisUrl` (committed `a29f32b`) extracts credentials + TLS from the URL. `/health` queue check green in production. |
| 4 | PostgreSQL credentialed + external/network access restricted | **PASS** | Render Postgres requires credentials + TLS; external-access IP allow-list explicitly set to no external entries at provisioning (Render default is open-to-any-IP, so this was a deliberate configuration step). API reaches it via the internal connection string only. `/health` database check green. |
| 5 | PostgreSQL instance = Basic-1GB, not 256 MB | **PASS** | Provisioned directly as Basic-1GB (0.5 CPU / 1 GB / 15 GB) per the gate review correction. |
| 6 | Object-storage credentials server-side only; R2 bucket not publicly readable | **PASS** | R2 bucket `agileworks-erp-documents` created private; no `r2.dev` public subdomain, no public custom domain. API token scoped to Object Read & Write on this one bucket. `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` held only in Render's env-var store. App issues short-lived signed URLs only — no `getPublicUrl` path exists. |
| 7 | HTTPS/TLS enforced | **PASS** | Render's edge terminates TLS and issues/renews certificates automatically for all three `*.onrender.com` services. Plain HTTP is redirected to HTTPS by Render. No application-level TLS. |
| 8 | `TRUST_PROXY_HOPS` correct for the real reverse-proxy topology (not guessed) | **PASS (2026-09-10)** | `TRUST_PROXY_HOPS=1` set on the API service. Verified empirically: a production Admin/Owner login wrote an `audit_logs` row with `action='login'`; its `ip_address` matched the operator's real public IP (from `api.ipify.org`) exactly — confirming Express, trusting exactly one hop, reads the client IP Render's single edge proxy appends, not an intermediate proxy address. Re-verification required if a custom domain or CDN proxy (e.g. Cloudflare) is later placed in front — see Open Items. |
| 9 | Application secrets use the hosting provider's environment/secret mechanism | **PASS** | All secrets (`DATABASE_URL`, `OCR_WORKER_DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `REDIS_URL`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) are Render environment variables (encrypted at rest, AES-128 minimum; TLS 1.2+ in transit). The Vertex AI service-account key is a Render **Secret File** (mounted at a path; `GOOGLE_APPLICATION_CREDENTIALS` points to it). No secret is committed to Git or hardcoded. |
| 10 | F7.1 Idempotency-Key length/charset validation (controlled 4xx, not 500) | **PASS (in deployed code)** | Committed `07a6e34`; unit + live e2e tests. Ships in the deployed API image. |
| 11 | PostgreSQL / Redis / object storage not exposed directly to end users | **PASS** | End users reach only `agileworks-erp-web` / `agileworks-erp-field` (Next.js) over HTTPS, which call the API over HTTPS. The three data stores have no public route: Postgres is internal-only + IP-restricted, Redis is authenticated `rediss://` reachable only by the API, R2 is private with signed-URL access only. |
| 12 | Tested backup/restore procedure preserved | **PASS** | Weekly Render Cron Job (`0 18 * * 6` UTC) runs `pg_dump --format=directory` as the least-privilege `app_backup` role, uploads to a dedicated private Cloudflare R2 bucket, independently verifies the upload, and pings a healthchecks.io heartbeat — [infra/backup/](../../infra/backup/). First live production run on **2026-09-13** completed successfully end-to-end (backup, upload, verification, heartbeat). The resulting object was then restore-tested into an isolated, disposable local PostgreSQL 18 container — full record below. |
| 13 | `prisma/seed.ts` usable in the Render environment | **PASS** | Env-loading bootstrap fixed to check `process.env.DATABASE_URL` before requiring a physical `.env` file (committed `2af7fe3`, isolated-logic tested). Production seed subsequently run by the operator; Admin/Owner login verified working through both `web` and `field`. |

---

## End-to-end signals observed in production

- API `/health` returns `ok: true` with database, queue, and storage sub-checks all healthy.
- 17 Prisma migrations applied; `prisma migrate status` reports the schema up to date.
- Admin/Owner login succeeds through `agileworks-erp-web` → dashboard loads.
- Admin/Owner login succeeds through `agileworks-erp-field` → `/home` loads and correctly shows the "not a Technician account" state (role-gated behavior intact).
- Login audit rows are written with the correct real client IP (item 8).

---

## Backup & restore verification record (2026-09-13)

The full backup → restore → validate cycle has now been exercised once,
end to end, against a real production backup.

### Production backup run

| Check | Result |
|---|---|
| Render Cron Job run | PASS — completed successfully |
| `pg_dump` | PASS |
| Upload to R2 (`agileworks-erp-backups/pg/`) | PASS |
| Independent object-existence/size verification (by the job itself) | PASS |
| Healthchecks.io heartbeat | PASS — received |
| Backup object | `pg_agileworks_erp_2026-09-13T11-52-32Z.dir.tar.gz`, 36,644 bytes |

### Isolated restore test

Performed the same day, entirely outside production: the backup object was
downloaded from the Cloudflare R2 dashboard (browser session, no R2 API
credential used locally), extracted, and restored into a disposable local
Docker container (`postgres:18-alpine`, bound to `127.0.0.1:55432` only,
database `restore_test`) — never the production database, never a
container reachable from any network. Cleaned up after validation; no
trace remains on disk or in `docker ps -a`.

| Check | Result |
|---|---|
| Downloaded archive integrity (size, SHA-256, `gzip -t`) | PASS |
| Valid `pg_dump` directory-format archive (`toc.dat` present, `pg_restore --list` parses cleanly) | PASS — 465 TOC entries, 52 `TABLE DATA` entries |
| `pg_restore -Fd --no-owner --no-privileges --single-transaction` | PASS — exit code 0, zero warnings/errors |
| Restored table count | 52 (51 `schema.prisma` models + `_prisma_migrations`, which is Prisma-internal, not a schema model — expected, not a discrepancy) |
| Representative row counts | `users`=1, `customers`=0, `work_orders`=0, `audit_logs`=4 — consistent with pilot-stage data volume |
| `system_settings` column structure | PASS — all 7 columns restored intact, including the `value_type` enum column |
| `_prisma_migrations` restored | PASS — 17 records; latest `20260831021556_f7_1_service_report_upload_idempotency` |
| Migration-state match vs. `prisma/migrations/` on disk | PASS — all 17 migrations match exactly, same names, same order, none rolled back |
| Overall result | **PASS — zero warnings or errors at any step** |

This confirms the backup this pilot relies on is not merely "uploaded" but
is actually restorable into a working, schema-correct, migration-consistent
database.

---

## Open items (not blocking pilot infrastructure, tracked)

| Item | Type | Recommended action | Deadline |
|---|---|---|---|
| **OCR successor-model qualification** | Model migration/validation | Run the two-tier qualification test ([pre-provisioning gate review](./phase7-p0-pre-provisioning-gate-review.md) §1) — Vertex AI Model Garden console check for an `asia-southeast1`-available GA successor, then the existing 21-document Phase 5 corpus through both `gemini-2.5-flash` and the candidate via the existing acceptance harness, against the approved `PILOT_ACCEPTANCE_TARGETS`. Do not change `VERTEX_AI_MODEL_ID` until it passes. | Before Gemini 2.5 Flash retirement (earliest 2026-10-16) |
| **Deploy commit `2af7fe3` to the API service** | Deployment step | Auto-Deploy is Off; trigger a manual deploy so the running API carries the `prisma/seed.ts` fix and any other changes since `1201b98`. Non-urgent (seed already run), but keeps deployed == `main`. | Housekeeping |
| **Synthetic end-to-end pipeline test** | Verification | Upload one non-real, non-customer test Service Report and confirm it flows upload → OCR extraction → staging → verify → confirm. Exercises magic-byte validation (item 2), the Vertex AI credential, and BullMQ in production. Incurs a small real Vertex AI charge. | Recommended before pilot users onboard |
| **`TRUST_PROXY_HOPS` re-verification on custom domain** | Configuration | If/when a custom domain is added — especially behind a CDN/proxy such as Cloudflare — repeat the item 8 audit-log IP check; the hop count may need to increase from `1`. | When DNS/domain stage is reached |
| **Uptime monitoring** | Optional | A free external uptime check against `https://agileworks-erp-api.onrender.com/health` — alerts from outside Render's network. | Optional |

---

## Not in scope

- DNS / custom domain — deliberately untouched.
- Wave 2 / public-production hardening — not started.
- OCR model change — `gemini-2.5-flash` retained pending qualification.
- Real customer data — not entered.
