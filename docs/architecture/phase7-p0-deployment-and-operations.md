# Phase 7 P0 — Private Pilot Deployment & Operations Requirements

Status: DOCUMENTATION, produced as part of Phase 7 P0 (Private Pilot Security
Readiness), approved scope only. Companion to
[phase7-production-security-review.md](./phase7-production-security-review.md)
(the read-only review this work remediates) and
[phase7-f7.1-idempotency-design.md](./phase7-f7.1-idempotency-design.md).

This document covers three of the nine approved P0 items that are primarily
deployment/operational rather than application-code changes:

- **Item 4** — PostgreSQL and MinIO: credential-based deployment support and
  required network isolation.
- **Item 6** — HTTPS/TLS deployment requirement.
- **Item 7** — Minimum private-pilot backup/restore procedure, with an actual
  restore test performed against development data.

It also carries the required **proposal-only** analysis for **Item 9** (stale
`IN_PROGRESS` idempotency claims) — per the approval's explicit instruction,
no code change was made for Item 9 in this pass.

---

## Item 4 — PostgreSQL and MinIO: credentials and network isolation

### Application support for credential-based deployment (verified, no code change needed)

**PostgreSQL.** The app has never connected with a hardcoded credential.
`DATABASE_URL` (runtime) and `MIGRATE_DATABASE_URL` (deploy-time only) are
both plain connection-string env vars, and
[`infra/sql/provision-roles.sql`](../../infra/sql/provision-roles.sql) already
provisions two distinct, least-privilege Postgres roles with passwords:
`app_migrator` (DDL only, used solely by `prisma migrate deploy`) and
`app_runtime` (DML only, the role the running API actually connects as — see
`grant-runtime-privileges.sql` for its table-level grants). A real deployment
supplies real generated passwords for both roles and points `DATABASE_URL` /
`MIGRATE_DATABASE_URL` at them; no application code changes.

**MinIO / S3-compatible object storage.**
[`s3-storage.provider.ts`](../../apps/api/src/common/storage/s3-storage.provider.ts)
already takes `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and
`S3_SECRET_ACCESS_KEY` from environment variables only — nothing hardcoded —
and works unmodified against a self-hosted MinIO instance or a real S3-
compatible bucket in production. As part of this P0 pass,
[`env.validation.ts`](../../apps/api/src/config/env.validation.ts) now
enforces that all five of those variables are actually present at boot
whenever `STORAGE_PROVIDER=s3` (see the "S3 env validation" commit and its
test, `env.validation.spec.ts`) — this closes the gap where a misconfigured
S3 deployment would previously fail confusingly at first upload instead of at
boot.

The local-disk storage provider (`STORAGE_PROVIDER=local`, the day-to-day
dev default) is unaffected and remains available for any deployment that
doesn't need S3/MinIO.

**No architectural change was made** — this is exactly "verify support,
document isolation," per the approved scope's explicit instruction not to
redesign the existing storage/database architecture.

### Required network isolation (deployment-time requirement — cannot be verified from this repo alone)

`infra/docker-compose.yml` (local development only) publishes Postgres
(`5432`), Redis (`6379`), and MinIO (`9000`/`9001`) directly on the host for
developer convenience. **This compose file must never be used as-is for the
pilot deployment.** For the private pilot:

- PostgreSQL, Redis, and MinIO/S3 **must not** be bound to a public network
  interface or exposed to the public Internet under any circumstance —
  no public IP, no port-forward, no public security-group/firewall rule.
- These three services should sit on a private network (a Docker
  user-defined network with no published ports, a cloud VPC private subnet,
  or the managed-service equivalent) reachable **only** by the `apps/api`
  process and, for Postgres, by an operator's bastion/VPN for maintenance.
- The **only** process that should be able to reach Postgres, Redis, and
  MinIO from outside that private network is the reverse proxy terminating
  public HTTPS traffic in front of the API (see Item 6) — and the reverse
  proxy itself talks to the API, never directly to the data stores.
- If the pilot uses a managed database/cache/object-storage service (RDS,
  managed Redis, S3 itself, etc.) instead of self-hosting, the equivalent
  requirement is: no public accessibility flag, security group scoped to the
  API's own subnet/security-group only, and TLS-in-transit enabled where the
  provider offers it (this pairs with the Redis `rediss://` support already
  added — see the security review's F-H1 and `parseRedisUrl`'s test suite).

**Classification: CONFIGURATION REQUIRED AT DEPLOYMENT.** This cannot be
marked verified from within this repository — it depends entirely on the
actual hosting environment and its network topology, which does not exist
yet. Whoever provisions the pilot environment must confirm the above before
traffic is enabled, and should re-check it against whatever the final
topology actually is (self-hosted Docker host vs. managed cloud services can
require different concrete steps to satisfy the same requirement).

---

## Item 6 — HTTPS/TLS deployment requirement

**Requirement (deployment-time, not yet — and not falsely — marked verified):**
All remote traffic to the private pilot, for every one of the three apps
(`apps/api`, `apps/web`, `apps/field`), **must** be served over HTTPS. Plain
HTTP must not be reachable from outside the deployment's own private network
in the pilot environment.

**Where TLS terminates.** TLS should terminate at the deployment
platform/reverse proxy (e.g., the load balancer of a managed platform, or an
Nginx/Caddy/Traefik reverse proxy the operator controls) sitting in front of
`apps/api`, not inside the NestJS process itself. This repo has no
application-level TLS certificate handling, and none should be added for the
pilot — a dedicated reverse proxy is simpler to operate correctly (automatic
cert renewal, standard HSTS/cipher configuration) and is the deployment shape
[`TRUST_PROXY_HOPS`](./phase7-production-security-review.md) was already
built for (single reverse proxy in front, `TRUST_PROXY_HOPS=1`).

Terminating TLS at the application layer instead would only be justified by
a demonstrated requirement this pilot does not have (e.g., no platform-level
reverse proxy available at all, or a compliance requirement for TLS all the
way to the process). Neither applies here.

**What "done" looks like, concretely, once a real host exists:**
1. A real TLS certificate (e.g., via the platform's managed certs, or
   Let's Encrypt through the reverse proxy) bound to the pilot's public
   hostname(s).
2. The reverse proxy redirects any plain-HTTP request to HTTPS (or simply
   doesn't listen on port 80 for non-redirect traffic).
3. `TRUST_PROXY_HOPS=1` is set on `apps/api` (already implemented and tested
   in this P0 pass — see `main.ts` and `trust-proxy.spec.ts`), so `req.ip`
   and the login rate limiter see the real client IP through that one
   trusted hop, not the proxy's own address.
4. `WEB_APP_ORIGIN` / `FIELD_APP_ORIGIN` (CORS) are set to the real `https://`
   origins, not `localhost`.

**Classification: CONFIGURATION REQUIRED AT DEPLOYMENT.** No hosting
environment exists yet to test TLS against, so this is explicitly *not*
marked as verified — doing so before an actual deployment exists would be a
false claim. This document defines the requirement and the concrete
checklist above for whoever performs that deployment.

---

## Item 7 — Minimum private-pilot backup/restore procedure

### Scope

Two things need backing up: the PostgreSQL database (all application data)
and the uploaded Service Report files / object-storage content (local-disk
or S3/MinIO, depending on `STORAGE_PROVIDER`). This section defines the
minimum viable procedure for both and records an actual restore test
performed against development data — **no production or real user data
exists yet, and none was touched.**

### PostgreSQL backup/restore procedure

**Backup** (logical dump, custom format — portable across minor Postgres
versions and restorable selectively if ever needed):

```bash
pg_dump -U <backup_role> -h <host> -d agileworks_erp -Fc -f agileworks_erp_YYYYMMDD.dump
```

Run this against `app_migrator`'s host access (or a dedicated read-only
`app_backup` role, least-privilege — the same reasoning as `app_runtime` vs
`app_migrator`) on a schedule (daily, at minimum, for the pilot's data
volume). Store the resulting `.dump` file encrypted at rest, off the
database host itself, with a retention window appropriate to the pilot
(e.g., 7–14 daily copies).

**Restore**, into a fresh/target database:

```bash
createdb -U <role> agileworks_erp_restored
pg_restore -U <role> -d agileworks_erp_restored --no-owner --no-privileges agileworks_erp_YYYYMMDD.dump
```

### Object-storage backup/restore procedure

- **`STORAGE_PROVIDER=local`**: back up the `STORAGE_LOCAL_ROOT` directory
  tree directly (filesystem-level backup/snapshot, or a straightforward
  `rsync`/`tar` on the same schedule as the database dump — the two should
  be taken close together in time so a restore returns to one consistent
  point).
- **`STORAGE_PROVIDER=s3`** (MinIO or a real S3-compatible bucket): mirror
  the bucket to a second bucket or a separate backup target using the
  provider's own tooling (`mc mirror`, `aws s3 sync`, or the provider's
  built-in cross-region/versioning replication if available).

### Restore test actually performed (2026-08-31, development data only)

Both procedures above were exercised for real against this session's
development database and MinIO instance — **not** simulated, and no
production/user data was involved (none exists yet):

**PostgreSQL:**
1. `pg_dump -Fc` the running dev `agileworks_erp` database (48 tables,
   including `audit_logs` at 23,701 rows) → a 1.7 MB custom-format dump.
2. Created a fresh `agileworks_erp_restore_test` database and ran
   `pg_restore --no-owner --no-privileges` into it — completed with no
   errors or warnings.
3. Verified integrity two ways:
   - Per-table row counts across all 48 tables matched exactly between the
     original and restored databases.
   - `md5(string_agg(t::text, ''))` content hashes over the full `users`
     and `service_reports` tables matched exactly between original and
     restored — not just row counts, the actual row content.
4. Cleaned up: dropped `agileworks_erp_restore_test` and removed the dump
   file from the container. The original `agileworks_erp` database was never
   modified.

**MinIO:**
1. Seeded two small test objects into the `agileworks-documents` bucket
   under a throwaway `backup-test/` prefix.
2. Created a second bucket and ran `mc mirror` from the first bucket's
   `backup-test/` prefix into it.
3. Verified: the mirrored bucket listed both objects, and `mc cat` against
   the mirrored copies returned byte-identical content to the originals.
4. Cleaned up: removed the mirror bucket and the seeded test objects from
   the original bucket, restoring MinIO to its pre-test state.

**Result: the backup and restore procedures work as documented, verified
against real (development) data, with no data loss and no content
divergence.**

### What remains deployment-specific

Scheduling (cron / platform-native backup scheduler), off-host/off-site
storage of the backup artifacts, encryption at rest for stored backups, and
exact retention policy all depend on the actual hosting platform chosen for
the pilot, which does not exist yet.

**Classification: IMPLEMENTED AND VERIFIED** for the procedure itself
(commands, and a real restore test against dev data, both done). **CONFIGURATION
REQUIRED AT DEPLOYMENT** for turning the procedure into an actual scheduled,
off-host job once a hosting platform is chosen.

---

## Item 9 — Stale `IN_PROGRESS` idempotency claims: proposal only (not implemented)

Per the approval's explicit instruction — *"Do not redesign F7.1 yet...if
[a fix is required before private pilot], propose it first rather than
implementing it automatically"* — this section is a proposal. **No code was
changed for this item in this P0 pass.**

### Is a fix required before private pilot?

**No.** This matches the original security review's own conclusion
(F-E4): the failure mode requires an actual server-side crash or
forced restart (OOM-kill, deploy, process manager restart) landing in the
narrow window between a claim's row being set to `IN_PROGRESS` and that same
request either completing or failing — no client request alone can trigger
it. For a short, actively-monitored private pilot with a small, known user
set, the operational likelihood is low, and a stuck claim affects only the
one `(uploader, idempotencyKey)` pair that happened to be in flight at the
moment of the crash — it does not affect any other upload, user, or
functionality (uploads without an `Idempotency-Key` header — the common
case today — are entirely unaffected, since they never create a claim row at
all).

### Interim mitigation for the pilot (no code change — a runbook step)

If a stuck claim is ever reported during the pilot (a caller retrying a
previously-interrupted upload with the same key gets a persistent `409
Conflict`), the operator can clear it manually:

```sql
UPDATE service_report_upload_idempotency_keys
SET status = 'FAILED'
WHERE id = '<the stuck row's id>' AND status = 'IN_PROGRESS';
```

This is safe: it only ever transitions a row that is genuinely stuck (still
`IN_PROGRESS` from a crashed request), and `FAILED` is already a normal,
re-claimable state in the existing state machine — the next retry with the
same key proceeds exactly as any other FAILED-key retry does today.

### Proposed fix, for a later wave (not this pass)

A time-based staleness check, reusing the exact guarded-`updateMany` pattern
already used for the `FAILED` → re-claim transition
(`service-reports.service.ts`, `claimIdempotencyKey()`,
[lines 229–236](../../apps/api/src/modules/service-reports/service-reports.service.ts#L229-L236)):

```ts
// Alongside the existing FAILED re-claim, atomically re-claim an
// IN_PROGRESS row that's been sitting untouched for too long to still be a
// live in-flight request.
const staleThreshold = new Date(Date.now() - STALE_IN_PROGRESS_MINUTES * 60_000);
const guarded = await this.prisma.serviceReportUploadIdempotencyKey.updateMany({
  where: {
    id: existing.id,
    status: IdempotencyKeyStatus.IN_PROGRESS,
    updatedAt: { lt: staleThreshold },
  },
  data: { status: IdempotencyKeyStatus.IN_PROGRESS }, // no-op write to bump updatedAt / retain shape, or transition to FAILED directly
});
```

The `updatedAt` column already exists on this model (`@updatedAt`, Prisma-
managed) with no schema change needed. The threshold (e.g., 15–30 minutes —
comfortably longer than any real upload should ever take) would be a small,
reviewable follow-up, plus 2–3 unit tests (a genuinely-recent `IN_PROGRESS`
row is still a `409`; an old one is eligible for re-claim; concurrent
re-claim attempts on the same stale row still only let one caller through).
This is intentionally left for the next wave rather than folded into this
P0 pass, per the approval's instruction.

**Classification: BLOCKED is not applicable — this is a proposal-only item
by explicit instruction, not an implementation gap.** It does not block
private pilot readiness (see above), and the interim manual-recovery step is
documented for the pilot's runbook.
