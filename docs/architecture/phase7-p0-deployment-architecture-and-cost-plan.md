# Private Pilot Deployment Architecture & Cost Plan

**Status: PLANNING DOCUMENT ONLY.** No cloud resources have been provisioned, no
DNS has been changed, no production credentials have been created, no
application code or architecture has been modified, and nothing has been
deployed. This document is the deliverable requested after Phase 7 P0
([phase7-production-security-review.md](./phase7-production-security-review.md),
[phase7-p0-deployment-and-operations.md](./phase7-p0-deployment-and-operations.md))
was accepted as the private-pilot application-security baseline. Wave 2 /
public-production hardening has not been started. **Stop point: this document
ends with a recommendation, awaiting explicit approval before any
provisioning begins.**

---

## 1. What actually has to be hosted (inspected from this repository)

This section is grounded in the current code, not assumed from the dev
`docker-compose.yml`. Two findings materially simplify the deployment versus
"one server per dev-compose service":

- **The BullMQ extraction processor runs inside the same NestJS process as
  the HTTP API** — `ServiceReportExtractionProcessor` is a provider inside
  `ExtractionModule`
  ([extraction.module.ts](../../apps/api/src/common/extraction/extraction.module.ts)),
  which is imported directly into `AppModule`
  ([app.module.ts](../../apps/api/src/app.module.ts)). There is no separate
  "worker" binary or process to deploy — **one Node.js process is the entire
  backend.** The `OCR_WORKER_DATABASE_URL` isolation
  ([ocr-worker-db-isolation.md](./ocr-worker-db-isolation.md)) is a
  *credential-level* isolation (a second Prisma client using a
  least-privilege DB role) within that same process, not a separate
  deployable.
- **`apps/web` and `apps/field` both require a running Node.js server**, not
  static hosting. The production build
  (`next build`) reports multiple `ƒ (Dynamic) server-rendered on demand`
  routes in both apps (e.g. `/customers/[id]`, `/quotations/[id]`,
  `/service-reports/[id]/verify`, `/jobs/[id]`) — these need `next start` (or
  an equivalent Next.js-aware host), not a static file server or CDN alone.

| Component | What it actually is | Must be hosted as | Notes |
|---|---|---|---|
| NestJS/API | 1 Node.js process (`apps/api`) | A long-running container/service (not serverless-cold-start-friendly, since it holds an open BullMQ/Redis connection and runs the in-process extraction worker) | Also serves `/health` for platform health checks ([health.controller.ts](../../apps/api/src/health/health.controller.ts)) |
| `apps/web` | Next.js 14 SSR app | Long-running Node.js server (`next start`) | Talks to the API via `NEXT_PUBLIC_API_BASE_URL`, a build-time-baked public value |
| `apps/field` | Next.js 14 SSR app | Long-running Node.js server (`next start`) | Same `NEXT_PUBLIC_API_BASE_URL` pattern, separate origin |
| PostgreSQL | Single database, 3 least-privilege roles already provisioned (`app_migrator`, `app_runtime`, `ocr_worker` — [provision-roles.sql](../../infra/sql/provision-roles.sql)) | One managed or self-hosted Postgres instance | No sharding/read-replica need at pilot scale |
| Redis/BullMQ | Two queues (`service-report-extraction`, `health-check`) | One Redis instance, reachable only by the API process | `ioredis`/BullMQ connection already supports `username`/`password`/`rediss://` TLS ([queue.module.ts](../../apps/api/src/common/queue/queue.module.ts), Phase 7 P0) |
| MinIO/S3 storage | `StorageProvider` interface, two adapters (`local`, `s3`) already implemented ([s3-storage.provider.ts](../../apps/api/src/common/storage/s3-storage.provider.ts)) | Any S3-API-compatible bucket — no MinIO-specific dependency | `STORAGE_PROVIDER=s3` plus 5 env vars, already validated at boot (Phase 7 P0) |
| OCR/Vertex AI | Outbound HTTPS call from the API process to Vertex AI (`@google/genai`, `vertexai: true`) | Not hosted at all — it's an API call, not a service to run | Auth is Google Application Default Credentials (ADC) — see §7 |
| Reverse proxy/TLS | Not implemented in-app by design (Phase 7 P0 decision) | One HTTPS entry point in front of `apps/api`, `apps/web`, `apps/field` | `TRUST_PROXY_HOPS` already built for exactly this shape ([main.ts](../../apps/api/src/main.ts)) |
| Background workers | None separate from the API process (see above) | N/A at this scale | A real split-out worker is a legitimate *future* scaling step, not needed now |
| Backups | Postgres + object storage content | A scheduled job (managed-platform-native, or a cron script) | Procedure already documented and restore-tested ([phase7-p0-deployment-and-operations.md](./phase7-p0-deployment-and-operations.md)) |
| Secrets/env vars | ~20 variables across 3 apps | Whatever secret store the chosen platform provides | Full inventory in §7 — names only, no values |

---

## 2. Three realistic architectures

All three assume the same application code, unmodified. They differ only in
**where** each component in §1 physically runs.

### Architecture A — Low-cost managed/cloud composition

Small managed services from different (all boring, wire-compatible) vendors,
each doing one job well. No server the company operates directly.

- **apps/api, apps/web, apps/field**: three small always-on container
  services on a platform like Render or Fly.io (each app is its own service;
  `apps/api` needs `min instances = 1` since it holds a live Redis
  connection and runs the in-process extraction worker — it cannot
  scale-to-zero).
- **PostgreSQL**: the platform's own managed Postgres (e.g. Render Postgres),
  reachable only over the platform's private network plus a TLS-required
  public endpoint restricted to nothing but the API service.
- **Redis**: Upstash Redis — TLS + token-authenticated by default, no
  concept of an "open, unauthenticated port" at all; billed per-request,
  which is effectively free at pilot volume (two lightweight queues).
- **Object storage**: Cloudflare R2 — S3-API-compatible (the app's
  `S3StorageProvider` already speaks this API with zero code change),
  10 GB storage and all egress free.
- **Reverse proxy/TLS**: the platform's own edge (automatic cert
  issuance/renewal for a custom domain) — nobody manages a certificate.

| | |
|---|---|
| **Est. monthly infra cost** | ~US$45–70/mo: 3 app services (~US$21–35), managed Postgres small tier (~US$7–19), Upstash Redis (~US$0–5 at this volume), R2 (US$0 within free tier) |
| **Security implications** | Postgres/Redis/storage are never on a public, unauthenticated port by default — the platform's own defaults already satisfy "not exposed publicly." TLS is handled centrally; fewer places to misconfigure. |
| **Maintenance burden** | Lowest of the three. No OS patching, no Docker Engine upgrades, no manual cert renewal. Mostly: `git push`, watch the deploy, occasionally bump a platform-managed Postgres/Redis version via a dashboard click. |
| **Backup/restore** | Managed Postgres includes automated daily backups (and often point-in-time recovery) in its base tier. R2 supports bucket versioning if enabled. The already-documented `pg_dump`/`mc mirror` procedure still works unchanged as an independent, portable backup. |
| **HTTPS/TLS setup** | Automatic — point a custom domain at the platform, it issues and renews the certificate. Zero ongoing action. |
| **Redis/Postgres/storage exposure** | Redis: never publicly reachable except via an authenticated, TLS `rediss://` endpoint. Postgres: restricted by the platform's own network/firewall rules to the app's private network (plus TLS-required if a public endpoint exists at all). Object storage: inherently API-key-gated, no "port" to expose. |
| **Secret management** | Each platform's own encrypted environment-variable/secret store (Render "Environment Groups", Fly "secrets", etc.) — set once per service, never committed to git. |
| **Deployment/update procedure** | `git push` to the connected branch triggers a build + deploy per service; rollback is redeploying the previous build/commit from the platform's dashboard or CLI — a few clicks, minutes. |
| **Expected scalability** | Vertical: bump instance size per service independently in seconds. Horizontal: add more `apps/api`/`apps/web` instances behind the platform's own load balancer — the app is already stateless (JWT bearer auth, no server-side session store), so this needs no code change. Redis/Postgres upgrade tiers independently as usage grows. |
| **Vendor lock-in** | Low. Postgres, Redis, and S3 are all wire/API-compatible standards — swapping any one of the three managed vendors later is a connection-string/credential change, not a rewrite. The only real lock-in is the app-hosting platform's own build/deploy tooling, which is a thin layer. |
| **If a service fails** | Each piece is independently managed and typically auto-restarts on crash within its provider's SLA; a single `apps/api` instance dying causes a brief interruption (seconds to low minutes) until the platform reschedules it, not a total outage of every component at once. Base-tier plans usually don't include automatic multi-zone failover — that is an available upsell if the pilot's uptime bar rises later. |
| **Singapore region** | Practical. Render, Fly.io, and Upstash all publish a Singapore (or Southeast Asia) region as of this writing; Cloudflare R2 is anycast/global by design (no region to pick, and no meaningful latency penalty for object storage either way). **Confirm current region availability directly with each vendor before purchase** — offerings change. |

### Architecture B — Simple VPS/container approach

One virtual machine, running the existing `infra/docker-compose.yml` shape
almost unchanged, plus a reverse-proxy container and no published ports for
Postgres/Redis/MinIO.

- One VPS (e.g. DigitalOcean or Vultr, Singapore region), sized around
  2 vCPU / 4 GB RAM for the pilot's expected load.
- `apps/api`, `apps/web`, `apps/field`, PostgreSQL, Redis, and MinIO all run
  as Docker containers on one internal Docker network on that VPS.
- **Only the reverse-proxy container publishes ports 80/443.** Postgres
  (5432), Redis (6379), and MinIO (9000/9001) are reachable *only* from
  other containers on that same internal network — never bound to the
  host's public interface at all (this is the concrete fix needed versus
  today's dev `docker-compose.yml`, which does publish those ports for
  local developer convenience).
- **Reverse proxy/TLS**: Caddy (automatic Let's Encrypt certificate
  issuance and renewal with a few lines of config) or Nginx + Certbot.
- **Backups**: a cron job on the VPS running the already-documented
  `pg_dump`/`mc mirror` commands, pushing the result to an *off-VPS* target
  (e.g. an R2 or Backblaze B2 bucket) — this has to be built, it does not
  come for free the way it does in Architecture A.

| | |
|---|---|
| **Est. monthly infra cost** | ~US$25–40/mo: one droplet (~US$18–24 for 2 vCPU/4 GB in Singapore) + a few dollars of off-site backup storage. Cheapest of the three. |
| **Security implications** | Correct *if* configured exactly as above (no published DB/Redis/MinIO ports) — but that correctness is now the operator's ongoing responsibility, not a platform default. A single misconfigured `docker-compose.yml` port mapping re-opens the exact exposure Phase 7 P0 closed. |
| **Maintenance burden** | Highest of the three. The operator owns OS security patching, Docker Engine upgrades, Postgres/Redis/MinIO version upgrades, disk-space monitoring, log rotation, and TLS renewal monitoring (Caddy automates renewal itself, but the operator still owns noticing if it silently breaks). |
| **Backup/restore** | Same documented, already-tested procedure (§7 of the operations doc), but the *scheduling and off-host transfer* must be built as a cron script — this is real, recurring work the company owns, not a platform feature. |
| **HTTPS/TLS setup** | Caddy automates issuance/renewal against Let's Encrypt — low effort to set up once, but it is a container the operator runs and must keep healthy. |
| **Redis/Postgres/storage exposure** | Correct by construction *if* no `ports:` mapping is added for those three services in the compose file — this must be verified explicitly and never regressed by a future "just for debugging" port publish. |
| **Secret management** | A `.env` file on the VPS (root-only file permissions), or a secrets manager the operator chooses to add (e.g. Doppler, `sops`). Nothing platform-provided by default — this is on the operator to get right. |
| **Deployment/update procedure** | SSH in, `git pull`, `docker compose build`, `docker compose up -d` — a brief restart-induced interruption per deploy unless a blue/green script is built (extra effort). Rollback = `git checkout` the previous tag and rebuild. |
| **Expected scalability** | Vertical only, cheaply (resize the droplet). Horizontal scaling (more than one VPS, a load balancer in front) is a real re-architecture step, not a dashboard click — a bigger lift than Architecture A when the time comes. |
| **Vendor lock-in** | Lowest of the three. Plain Docker Compose runs identically on literally any VPS provider, or even on-prem hardware later — maximum portability. |
| **If a service fails** | **Single point of failure for everything** — API, web, field, database, cache, and object storage all go down together if the VPS itself has a hardware fault, kernel panic, or provider outage. Recovery is: provision a new VPS, restore from the off-site backup, redeploy — a manual procedure measured in tens of minutes to a few hours, not automatic. |
| **Singapore region** | Practical — DigitalOcean (SGP1) and Vultr both publish a Singapore datacenter as of this writing. (Hetzner, sometimes considered for its low price, does **not** currently offer a Singapore region — only Europe/US — so it is excluded here on that basis alone.) |

### Architecture C — More managed/scalable (GCP-native)

Materially different from A, not just "bigger": because Vertex AI/Gemini is
already an approved GCP dependency, running the app tier on GCP too removes
an entire category of secret management that A and B cannot avoid (see the
callout below).

- **apps/api, apps/web, apps/field**: Cloud Run services (serverless
  containers). `apps/api` set to `min-instances=1` (it cannot scale to zero
  — same reasoning as Architecture A); `apps/web`/`apps/field` can scale to
  zero overnight for extra savings, at the cost of an occasional cold start.
- **PostgreSQL**: Cloud SQL for Postgres, smallest tier, **private IP
  only** (no public IP assigned at all), reached via a Serverless VPC
  Connector from Cloud Run.
- **Redis**: Memorystore for Redis, smallest Basic tier — private-only by
  design, but this is the single biggest cost driver in this architecture
  (Memorystore's price floor is materially higher than a small VPS or
  Upstash's pay-per-request model at this traffic volume).
- **Object storage**: kept on Cloudflare R2 or AWS S3 rather than native
  Google Cloud Storage — GCS's own API is not the same S3-compatible
  surface `S3StorageProvider` already speaks, so switching to GCS would
  require an adapter code change (explicitly out of scope for this
  planning document). Staying cross-cloud for storage alone is a
  perfectly normal, low-risk pattern.
- **Reverse proxy/TLS**: fully managed by Cloud Run — a global HTTPS load
  balancer and automatic certificates are included, no extra service to run.

> **Why this option is materially different, not just "AWS/GCP instead of a
> PaaS":** the Vertex AI call in `vertex-gemini.provider.ts` authenticates
> via Google's Application Default Credentials, with no explicit key
> material in the constructor call. Off-GCP (Architectures A and B), that
> means provisioning and protecting a downloaded service-account JSON key
> as a real secret. **On** Cloud Run, the service simply runs *as* an
> attached service account — Vertex AI calls are authenticated with no key
> file anywhere, ever. That is a genuine security simplification specific
> to this architecture, not a marketing distinction.

| | |
|---|---|
| **Est. monthly infra cost** | ~US$90–150+/mo even before real pilot traffic: Cloud Run (~US$10–25 with one always-on API instance), Cloud SQL smallest tier (~US$25–50), Memorystore Basic (~US$35+ price floor), VPC connector (~US$10). Highest of the three at this scale. |
| **Security implications** | Best of the three by default — Cloud SQL/Memorystore have no public-IP option to accidentally enable, IAM governs every credential, and the Vertex AI key-file problem disappears entirely (see callout above). |
| **Maintenance burden** | Low, similar to Architecture A — no OS/container-runtime patching — but GCP's own console/IAM/networking concepts (VPC connectors, service accounts, IAM roles) carry a steeper one-time learning curve than a simple PaaS dashboard. |
| **Backup/restore** | Cloud SQL automated daily backups + point-in-time recovery included in the base price; the same documented `pg_dump`/`mc mirror` procedure still works as an independent, portable backup. |
| **HTTPS/TLS setup** | Fully managed by Cloud Run — zero ongoing action, same as Architecture A. |
| **Redis/Postgres/storage exposure** | Cloud SQL private-IP-only and Memorystore are structurally incapable of public exposure inside a correctly-configured VPC — arguably the hardest of the three to misconfigure into public exposure. |
| **Secret management** | Google Secret Manager, IAM-scoped per service — and, per the callout above, the Vertex AI credential itself is not a secret at all when running here (attached service-account identity). |
| **Deployment/update procedure** | `gcloud run deploy` (or a connected CI pipeline); Cloud Run retains prior revisions and rollback is a single command (`gcloud run services update-traffic --to-revisions=<previous>=100`) — the fastest, safest rollback story of the three. |
| **Expected scalability** | Highest of the three — true request-driven autoscaling for `apps/web`/`apps/field`, generous ceiling for `apps/api`, and Cloud SQL/Memorystore both offer straightforward vertical upgrade paths plus optional HA tiers later. |
| **Vendor lock-in** | Highest of the three — Cloud Run, Cloud SQL, and Memorystore are GCP-specific products, though the underlying technology (containers, Postgres, Redis) is still portable in principle; migrating off would mean redoing the infra config, not rewriting the app. |
| **If a service fails** | Best of the three — Cloud Run auto-heals and reschedules failed instances automatically; Cloud SQL/Memorystore both support optional HA/failover tiers (extra cost) if the pilot's uptime bar rises. |
| **Singapore region** | Directly practical, and already the *de facto* precedent: `VERTEX_AI_REGION=asia-southeast1` (Singapore) is already the Phase 5-approved OCR region. Running Cloud Run/Cloud SQL/Memorystore in the same `asia-southeast1` region keeps the OCR call itself same-region/low-latency, on top of matching this HVAC company's own Asia/Manila timezone. |

---

## 3. Recommendation for the AgileWorks private pilot

**Recommended: Architecture A — low-cost managed/cloud composition** (small
app-hosting platform + managed Postgres + Upstash Redis + Cloudflare R2).

**Why, at this specific scale:**

- **Lowest maintenance burden for the cost.** A small HVAC service company
  running its first pilot has no dedicated ops staff. Architecture B is
  roughly US$15–30/mo cheaper, but that gap is paid back — with interest —
  in ongoing OS/Docker/Postgres/Redis patching and in the risk that a single
  misconfigured `docker-compose.yml` line quietly re-exposes a database
  port. Architecture A's managed defaults make several of the Phase 7 P0
  requirements (non-public Redis, non-public Postgres) essentially
  impossible to get wrong by accident, rather than something that must be
  correctly maintained forever.
- **Low, not zero, lock-in.** Every piece in Architecture A (Postgres,
  Redis, S3-compatible storage) is a wire/API-compatible standard the app
  already speaks natively — nothing here is a one-way door. That directly
  satisfies "a reasonable path to scale later": if the pilot succeeds and
  usage grows, the credible next step is exactly Architecture C, and it is
  a configuration migration (new connection strings/credentials), not an
  application rewrite.
- **Cost is genuinely low at this scale.** Architecture C's Memorystore
  price floor alone (~US$35+/mo) is a poor trade for a pilot with a small,
  known user base and low request volume; Architecture A's Redis usage
  (two lightweight BullMQ queues) fits comfortably inside Upstash's
  pay-per-request pricing, likely a few dollars a month or less.
- **Deployment/rollback is simple enough for a solo technical operator** —
  `git push`, watch a build, redeploy a previous version if something's
  wrong — without needing to learn a cloud provider's IAM/VPC model first.

**When to revisit this recommendation:** if the pilot's traffic, data
volume, or uptime requirements grow materially (more field technicians,
heavier OCR volume, a hard uptime SLA to a paying customer base), Wave 2
should re-evaluate Architecture C specifically for the Vertex AI
credential-management improvement and the higher autoscaling ceiling — not
because Architecture A will have failed, but because the cost/complexity
trade tips at higher scale.

---

## 4. Mapping the three remaining P0 deployment requirements onto Architecture A

### 4.1 Authenticated, non-public Redis

Point `REDIS_URL` at the Upstash instance's `rediss://` connection string
(username + password/token embedded, TLS scheme). The Phase 7 P0
`parseRedisUrl` fix
([queue.module.ts](../../apps/api/src/common/queue/queue.module.ts)) already
extracts `username`/`password` from the URL and sets `tls: {}` whenever the
scheme is `rediss:` — no further code change needed. Upstash has no
unauthenticated access mode at all, so "non-public" is the default, not a
setting to remember.

### 4.2 Credentialed, network-isolated PostgreSQL and object storage

- **Postgres**: create the managed instance, then run the existing
  [provision-roles.sql](../../infra/sql/provision-roles.sql) /
  [grant-runtime-privileges.sql](../../infra/sql/grant-runtime-privileges.sql)
  against it exactly as documented, generating real passwords for
  `app_migrator`, `app_runtime`, and `ocr_worker` at that time (not before,
  and not displayed in this document). Point `DATABASE_URL`,
  `MIGRATE_DATABASE_URL`, and `OCR_WORKER_DATABASE_URL` at the three
  resulting roles. Restrict the managed Postgres instance's network access
  to the app-hosting platform's private network / allowed-IP list — never a
  fully public `0.0.0.0/0` allow rule.
- **Object storage**: create a dedicated R2 bucket and an API token scoped
  to only that bucket (not an account-wide key). Set `STORAGE_PROVIDER=s3`
  plus `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY` — all five are already boot-time-validated
  ([env.validation.ts](../../apps/api/src/config/env.validation.ts), Phase 7
  P0). R2 has no public/unauthenticated read mode unless a bucket is
  explicitly made public, which this app never needs (`S3StorageProvider`
  only ever issues short-lived signed URLs, never a public URL).

### 4.3 HTTPS/TLS termination

Point the pilot's domain at the chosen app-hosting platform and let it
issue/renew the certificate automatically — no certificate file the company
manages. Set `TRUST_PROXY_HOPS` to match **exactly** how many proxy hops
that platform's edge actually adds in front of the Nest process (commonly
`1`, but this must be confirmed against the specific platform's documented
request path, not assumed) — then verify empirically post-deploy that
audit-logged IPs and the login rate limiter both see real client IPs, not
the platform's own internal address, per the existing
[trust-proxy.spec.ts](../../apps/api/test/trust-proxy.spec.ts) reasoning.

---

## 5. Required environment variables/secrets (names only — no values, none generated)

No credentials were displayed, generated, rotated, or committed in producing
this list.

**`apps/api`:**

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Runtime Postgres connection (`app_runtime` role) |
| `MIGRATE_DATABASE_URL` | Deploy-time-only Postgres connection (`app_migrator` role) |
| `OCR_WORKER_DATABASE_URL` | Extraction-staging-only Postgres connection (`ocr_worker` role) |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Auth token signing |
| `REDIS_URL` | BullMQ/Redis connection (`rediss://` with credentials) |
| `STORAGE_PROVIDER` | `s3` for the pilot |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Object storage connection/credentials |
| `EXTRACTION_PROVIDER` | `vertex-gemini` for the pilot |
| `VERTEX_AI_PROJECT_ID`, `VERTEX_AI_REGION`, `VERTEX_AI_MODEL_ID` | Vertex AI target config (region already decided: `asia-southeast1`) |
| `GOOGLE_APPLICATION_CREDENTIALS` (or equivalent ADC mechanism) | Vertex AI authentication — a service-account key file path off-GCP; not needed at all if this workload ever moves to Cloud Run (Architecture C) |
| `WEB_APP_ORIGIN`, `FIELD_APP_ORIGIN` | CORS allowlist |
| `TRUST_PROXY_HOPS` | Reverse-proxy hop count (verify against the chosen platform) |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME` | First-boot bootstrap admin only |
| `NODE_ENV`, `PORT` | Standard runtime config |

**`apps/web`, `apps/field`:**

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | Public (non-secret) API origin, baked in at build time — requires a rebuild if it changes |

---

## 6. Proposed deployment sequence (not yet executed)

1. Provision the managed Postgres instance; run
   `provision-roles.sql`/`grant-runtime-privileges.sql` to create the three
   least-privilege roles with newly generated passwords (generated and
   stored in the platform's secret store at that time, not shown here).
2. Provision the Upstash Redis instance and the R2 bucket + scoped API
   token.
3. Provision the Vertex AI service-account credential per the already-
   approved Decision 1 config (project/region/model), scoped to only the
   Vertex AI permissions it needs.
4. Set all environment variables from §5 in the app-hosting platform's
   secret store for `apps/api`.
5. Deploy `apps/api` first; confirm `/health` reports all three checks
   (database, queue, storage) healthy before proceeding.
6. Run `prisma migrate deploy` against the new database (using
   `MIGRATE_DATABASE_URL`) and the seed script once, to bootstrap the admin
   account.
7. Set `NEXT_PUBLIC_API_BASE_URL` for `apps/web`/`apps/field` to the now-live
   API's URL, then deploy both.
8. Point the pilot's domain(s) at the platform and confirm automatic HTTPS
   issuance succeeds.
9. Set `TRUST_PROXY_HOPS` correctly for the platform and verify real client
   IPs appear in audit logs (not the platform's internal address).
10. Schedule the backup job (platform-native for Postgres; a small scheduled
    task hitting the documented `mc mirror`-equivalent for object storage).
11. Run the full smoke-test pass (login, one Service Report upload, one
    quotation flow) against the live pilot URL before handing it to real
    users.

## 7. Rollback plan

- **Bad `apps/api` deploy**: redeploy the previous known-good build/commit
  from the platform's dashboard or CLI — no database rollback implied,
  since API deploys don't run destructive migrations by themselves.
- **Bad database migration**: `prisma migrate deploy` failures block the
  deploy before traffic shifts (this is already how the app's migration
  step behaves); if a migration completes but causes a runtime problem,
  restore from the most recent verified Postgres backup into a fresh
  instance and re-point `DATABASE_URL`/`MIGRATE_DATABASE_URL`/
  `OCR_WORKER_DATABASE_URL` — the exact restore procedure was already
  built and verified in Phase 7 P0.
- **Bad `apps/web`/`apps/field` deploy**: redeploy the previous build the
  same way as `apps/api` — these are stateless and safe to roll back
  independently of the API or database.
- **Total platform outage**: this is exactly why Architecture A's
  components are wire-compatible standards — worst case, redeploy the same
  container images against a different provider's Postgres/Redis/S3-
  compatible endpoints using the same env-var shape, no code change.
- **Credential compromise at any point**: rotate the affected credential at
  its source (Postgres role password, R2 API token, Redis token, JWT
  secrets) and redeploy `apps/api` with the new value — none of these are
  baked into a build artifact, all are runtime environment variables.

---

## Explicit guardrails honored in this document

- No cloud resources were provisioned.
- No DNS was modified.
- No production credentials were displayed, generated, or committed.
- No application code or architecture was modified.
- Wave 2 / public-production hardening was not started.
- This document stops at a recommendation and awaits approval before any
  provisioning step in §6 begins.
