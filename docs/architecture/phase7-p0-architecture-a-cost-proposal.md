# Architecture A — Concrete Provider Stack & Cost Proposal

**Status: PLANNING DOCUMENT ONLY.** No accounts created, no resources
provisioned, no DNS changed, no code/config/schema modified, nothing
deployed. This document converts the provisionally-preferred Architecture A
from
[phase7-p0-deployment-architecture-and-cost-plan.md](./phase7-p0-deployment-architecture-and-cost-plan.md)
into a named provider stack with current published pricing, so it can be
approved or rejected concretely. **Stop point: ends with a GO / GO WITH
CONDITIONS / NO-GO recommendation, awaiting explicit approval.**

Pricing below reflects publicly published rates checked on **2026-08-31**.
Every figure is labeled either **(confirmed — primary source)** or
**(secondary-sourced / verify before purchase)** — providers change pricing
without notice, and this document does not stand in for checking the live
page at signup time.

---

## 1. Recommended provider per component

| Component | Provider · Plan | Region | Singapore available? |
|---|---|---|---|
| API/NestJS hosting | **Render** — Web Service, **Standard** (2 GB RAM / 1 CPU) | Singapore | Yes — one of Render's 5 published regions |
| apps/web hosting | **Render** — Web Service, **Starter** (512 MB / 0.5 CPU) | Singapore | Yes |
| apps/field hosting | **Render** — Web Service, **Starter** (512 MB / 0.5 CPU) | Singapore | Yes |
| PostgreSQL | **Render Postgres** — Basic-256mb → Basic-1gb as data grows | Singapore | Yes |
| Redis/BullMQ | **Upstash Redis** — Pay-as-you-go, single-region | AWS ap-southeast-1 (Singapore) | Yes |
| Object/document storage | **Cloudflare R2** — Pay-as-you-go, `apac` location hint | Asia-Pacific (best-effort, not a hard region guarantee — see §7) | Best-effort only, see §7 |
| HTTPS/TLS + DNS/reverse proxy | **Render's own edge** (cert + termination) + any domain registrar for DNS | — (edge is Render's own network) | N/A — handled centrally |
| Backup storage | Same **Cloudflare R2** account, separate bucket/prefix | Asia-Pacific | Best-effort |
| Monitoring/logging | **Render's built-in logs/metrics** (included); optional free external uptime check | — | N/A |
| Vertex AI/Gemini OCR | **Google Cloud Vertex AI**, `gemini-2.5-flash` (already-approved model) | `asia-southeast1` (already the Phase 5-approved region) | Yes — already the precedent |

**Why Render specifically, over Fly.io (the other Architecture-A candidate
named in the prior comparison):** Render publishes an explicit, named
Singapore region and a documented, configurable Health Check Path — both
load-bearing for this stack — with clearer first-party documentation on
secrets handling and Postgres PITR than what was verifiable for competitors
in the time available for this review. This is a reasonable default choice,
not the only viable one — Fly.io remains a credible alternative if pricing
or region behavior differs materially once verified directly.

**Why not the free tier of any of these, for the API/web/field/Postgres/Redis
components** (explicit check, as requested):

| Free tier | Why it's excluded for a real pilot |
|---|---|
| Render free Web Service | Spins down after 15 min idle; **the filesystem is wiped on every spin-down/restart**, and wake-up takes ~1 minute of user-visible downtime. Render's own docs say outright: "Do not use them for production applications." |
| Render free Postgres | **Expires 30 days after creation**, then a 14-day grace period, then Render **permanently deletes the database**. A pilot is expected to run longer than 30 days. |
| Render free Key-Value (Redis) | **In-memory only — data is lost on every restart.** Not used here regardless, since Upstash is the Redis choice. |
| **Cloudflare R2 free allowance** — **kept, not excluded** | This is the one free tier judged appropriate. Unlike the three above, R2's free allowance (10 GB storage, 1M/10M monthly operations) is the *same durable service* as the paid tier, just free below a usage threshold — no sleep, no forced expiry, no in-memory-only mode. At this pilot's volume (§3), usage is expected to stay inside or barely above the free allowance regardless. |

---

## 2. Fixed monthly infrastructure cost (scenario-independent baseline)

| Line item | Cost/mo | Source confidence |
|---|---|---|
| `apps/api` — Render Web Service, Standard (2 GB/1 CPU) | **$25** | Secondary-sourced (Render's compute pricing table is JS-rendered and could not be scraped directly; $25 for the "Standard" 2 GB/1 CPU tier was corroborated by two independent sources) — **verify at render.com/pricing** |
| `apps/web` — Render Web Service, Starter (512 MB/0.5 CPU) | **$7** | Same as above |
| `apps/field` — Render Web Service, Starter (512 MB/0.5 CPU) | **$7** | Same as above |
| Render Postgres compute, Basic-256mb tier | **~$6–7** | Secondary-sourced — verify exact figure |
| Render Postgres storage (1 GB included) | **$0** at pilot's data volume | Overage published at $0.30/GB/mo beyond the included amount (secondary-sourced) |
| Render workspace plan | **$0 (Hobby)** | Confirmed — Hobby is Render's no-cost workspace tier; see §5 for when to upgrade |
| Domain registration (amortized) | **~$1–1.5** | A one-time ~$10–15/yr registration, amortized — exact price depends on the domain/TLD chosen |
| HTTPS/TLS certificate | **$0** | Confirmed — automatic issuance/renewal at Render's edge, included |
| Monitoring/logging | **$0** | Confirmed — Render's built-in log/metrics dashboard is included; no separate observability product recommended at this scale (see §6) |
| **Fixed subtotal** | **≈ $47/mo** (LOW/NORMAL) → **≈ $60/mo** once Postgres is upsized to Basic-1gb for GROWTH | |

**Why `apps/api` gets the Standard (2 GB) tier, not Starter (512 MB):** the
upload endpoint uses NestJS's `FileInterceptor` with no `storage:` engine
specified
([customers.controller.ts:148](../../apps/api/src/modules/customers/customers.controller.ts#L148)),
which defaults to **Multer's in-memory storage** — every uploaded Service
Report file (up to the app's own 25 MB cap) is held as a Node.js `Buffer` in
process memory for the duration of the request, not streamed to disk. A
handful of field technicians uploading concurrently, plus normal
NestJS/V8 baseline memory, leaves too thin a margin on a 512 MB instance.
2 GB gives real headroom without any code change.

---

## 3. Usage-dependent costs, by pilot scenario

Volume assumptions below are **stated estimates, not measured data** — no
pilot has run yet. They should be replaced with real numbers after the
first few weeks of actual use.

| Scenario | Users | Assumed reports/month | Assumed new storage/month |
|---|---|---|---|
| **LOW** | 3–5 | ~60–120 | ~0.15–0.3 GB |
| **NORMAL** | 5–10 | ~240–450 | ~0.5–0.9 GB |
| **GROWTH** | 15–25 | ~900–1,800 | ~1.8–3.6 GB |

| Usage-dependent line item | LOW | NORMAL | GROWTH | Basis |
|---|---|---|---|---|
| Vertex AI/Gemini OCR (`gemini-2.5-flash`) | **$1–3/mo** | **$3–8/mo** | **$10–25/mo** | See §4 — estimated $/document, **not yet measured against real usage** |
| Upstash Redis (pay-as-you-go: $0.20/100K commands, $0.25/GB beyond 1 GB free) | **~$0–1** | **~$0–2** | **~$2–5** | 2–6 BullMQ commands/job (extraction queue + health-check queue); trivial volume at this scale |
| Cloudflare R2 storage + operations | **$0** | **$0** | **~$0–1** | Storage at $0.015/GB/mo and operations at $4.50/$0.36 per million stay inside or barely above the 10 GB / 1M-op / 10M-op free allowance even at GROWTH's cumulative volume within the pilot's likely duration |
| Postgres storage overage | **$0** | **$0** | **$0–2** | Business + audit-log data stays well under a few GB at this user count within a pilot timeframe |
| Bandwidth/egress (Render) | **$0 (expected)** | **$0 (expected)** | **$0 (expected)** | Render's paid-tier included bandwidth allowance could not be confirmed from a static fetch of the pricing page — **verify at signup**; traffic at this user count is very unlikely to exceed any published allowance |
| Backup storage (weekly `pg_dump` + object mirror, ~90-day retention) | **$0** | **$0** | **$0** | Low tens/hundreds of MB even accumulated over months — inside R2's free allowance |

### Total estimated monthly cost

| Scenario | Fixed | Usage-dependent | **Total** |
|---|---|---|---|
| **LOW** | ~$47 | ~$1–4 | **≈ $48–51/mo** |
| **NORMAL** | ~$47 | ~$4–11 | **≈ $51–58/mo** |
| **GROWTH** | ~$60 (Postgres upsized) | ~$12–33 | **≈ $72–93/mo** |

**Vertex AI/Gemini usage is shown separately throughout, as requested — it
is billed by Google directly, independent of every other line above, and
is the only cost that scales meaningfully with OCR volume.** At all three
scenarios it remains a small fraction of the total, because Gemini 2.5
Flash's per-token price is low and a scanned service-report page is a
small amount of model input relative to typical LLM workloads.

---

## 4. How the OCR cost estimate was built (and its limits)

Gemini 2.5 Flash is priced (confirmed, official — [ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing)) at
**$0.30 per 1M input tokens** (text/image/video) and **$2.50 per 1M output
tokens**. This document could not confirm from a fetchable page whether
Vertex AI's list price for the same model differs from this Gemini
Developer API rate — Google publishes them on separate pages, and the
Vertex-specific page did not return usable content in this session. Vertex
AI pricing for Gemini models is generally published to match the Developer
API rate for the same model, but **this specific parity is unverified here
and should be checked against
[cloud.google.com/vertex-ai/generative-ai/pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing)
directly before relying on it for budgeting.**

Per-document estimate (order-of-magnitude, not measured): a single
service-report page's image tokens, plus the extraction prompt's fixed
instructional/taxonomy text
([vertex-gemini.provider.ts](../../apps/api/src/common/extraction/providers/vertex-gemini.provider.ts)
constructs a substantial structured-output schema and instruction set),
plus structured JSON output, land in a rough **3,000 input / 800 output
token** budget per model call — roughly **$0.003/call**.
`AdaptiveExtractionService` sometimes issues 2–3 calls for one document
when its own consensus/verification triggers fire (observed in this
session's test logs), so an average of **~1.3 calls/document** is assumed,
giving **~$0.004/document**. **This has not been validated against a single
real production document and should be re-measured from actual Google
Cloud billing after the pilot's first 1–2 weeks.**

### A live, dated risk worth flagging now

**Gemini 2.5 Flash — the model this app is already configured to use
(`VERTEX_AI_MODEL_ID="gemini-2.5-flash"` in `.env.example`) — has a
confirmed earliest possible retirement date of October 16, 2026,** per
Google's own user notifications. Today is August 31, 2026 — under seven
weeks away. Google has said the final date depends on Gemini 3's general
availability and that at least six months' notice will follow once it's
locked in, but there are independent reports of the model returning
model-unavailable errors ahead of any official date. **This is a real
operational risk to the pilot, not a hosting-cost matter, and is explicitly
out of scope for this document to fix** (it would mean changing
`VERTEX_AI_MODEL_ID`, which is a config/code change this document is not
authorized to make). Recommend tracking Google's migration notice and
having a tested fallback plan (a newer Flash-tier model, or reverting to
the `stub` extraction provider temporarily) ready before the pilot goes
live, independent of the hosting decision here.

---

## 5. One-time setup costs

- **Domain registration**: ~$10–15/year for a standard TLD, one-time
  (amortized into §2 above). No other one-time fee was found for Render,
  Upstash, R2, or Vertex AI — all bill purely on ongoing usage/subscription.
- **No setup/activation fee** identified for any component in this stack.

---

## 6. Monitoring/logging — is a separate product required?

**No, not at this scale.** Render's own dashboard includes request logs and
basic resource metrics at no extra cost, and the app already exposes a
meaningful `/health` endpoint checking database, queue, and storage
connectivity
([health.controller.ts](../../apps/api/src/health/health.controller.ts)).
Adding a dedicated observability product (e.g., a paid log-aggregation or
APM tool) would be a real, avoidable cost at a handful of users. The one
recommended *optional, likely-free* addition is an external uptime check
(e.g., a free-tier uptime monitor hitting `/health` every few minutes) —
useful because it alerts the operator from *outside* Render's own network if
the whole service becomes unreachable, which Render's own internal
dashboard cannot detect about itself.

---

## 7. Object storage: R2 vs. a Singapore-pinned S3-compatible alternative

**R2 remains the recommended choice for this pilot**, with one honest
caveat spelled out:

- R2 has **no literal Singapore region guarantee** — only an `apac`
  *location hint*, which Cloudflare's own docs describe as "best effort and
  not a guarantee." A hard regulatory or contractual requirement for
  verified Singapore-only data residency would not be satisfied by R2 as
  configured.
- **DigitalOcean Spaces (SGP1)** is a genuine, verified-region alternative:
  a real, named Singapore datacenter, S3-API-compatible (zero code change
  to `S3StorageProvider`), $5/mo base including 250 GiB storage and 1 TiB
  egress, $0.02/GiB storage and $0.01/GiB egress beyond that.
- **Trade-off, concretely:** R2 costs effectively $0/mo at this pilot's
  volume with no hard region guarantee; DO Spaces SGP1 costs a flat $5/mo
  with a real, verifiable Singapore region. Neither requires any code
  change — `STORAGE_PROVIDER=s3` plus five env vars either way.
- **Recommendation:** stay with R2 for the pilot, since nothing in this
  repository or the approved plans states a hard data-residency requirement
  today. **If AgileWorks takes on a customer contract or compliance
  obligation requiring verified Singapore-only storage of uploaded
  documents, switch to DO Spaces SGP1 before that data is ever written** —
  it is a five-variable configuration change, not an architecture change.

---

## 8. PostgreSQL backup/PITR — confirmed capability

- **Point-in-time recovery is included on every paid Render Postgres
  instance** (confirmed — [render.com/docs/postgresql-backups](https://render.com/docs/postgresql-backups)), with the *recovery
  window* depending on the account's workspace plan: **3 days on the free
  Hobby workspace, 7 days on Pro or higher** — this is a workspace-level
  setting, not a per-database purchase.
- **Render also retains on-demand logical (`pg_dump`-style) backups for 7
  days regardless of workspace plan**, and its own documentation
  *explicitly recommends* automating `pg_dump` exports to S3-compatible
  storage for retention beyond that window — which is precisely the
  procedure this project already built and restore-tested in Phase 7 P0
  ([phase7-p0-deployment-and-operations.md](./phase7-p0-deployment-and-operations.md)).
- **Confirmed: the already-tested `pg_dump`/`pg_restore` procedure works
  unchanged against Render Postgres** — it's a standard Postgres connection
  string, nothing Render-specific about it.
- **Recommendation:** start on the **Hobby workspace** (3-day PITR, $0) and
  layer the existing `pg_dump`-to-R2 procedure on a weekly schedule for
  durable, longer-retention recovery — Render's own PITR window is for a
  fast "undo the last few hours," not the pilot's real long-term backup,
  which the independently-tested procedure already covers. Revisit the
  $25/mo Pro workspace upgrade if the team grows past one member or a
  longer built-in PITR window becomes worth paying for on its own.

---

## 9. Confirming the three Phase 7 P0 network-exposure requirements, concretely

| Requirement | Status on this stack |
|---|---|
| **Redis: authenticated, non-public** | **Confirmed.** Upstash has no unauthenticated access mode at all — every connection requires the issued token, and `rediss://` (TLS) is the standard connection form. The already-implemented `parseRedisUrl` fix extracts this automatically. |
| **PostgreSQL: credentialed, network-restricted** | **Confirmed, with one action item.** Render Postgres requires credentials and supports a TLS-required connection string; Render's dashboard additionally allows restricting external access. **Action for whoever provisions this: explicitly enable/verify Render Postgres's access-restriction setting (IP allowlist or private-network-only, per whatever Render currently offers) rather than leaving the default** — this is a real setting to check, not an assumption to make from this document. |
| **Object storage: non-public** | **Confirmed.** R2 buckets default to private; the app never requests a public bucket or public URL — `S3StorageProvider` only ever issues short-lived signed URLs. |
| **HTTPS/TLS termination** | **Confirmed, mechanism.** Render's edge issues and renews the certificate automatically once a custom domain is attached — no certificate the company manages. |

---

## 10. How the application-hosting provider (Render) interacts with the current app

- **`TRUST_PROXY_HOPS`**: Render's own edge is expected to add exactly one
  proxy hop in front of the Nest process, matching `TRUST_PROXY_HOPS=1` —
  but **this specific hop count could not be confirmed from Render's public
  documentation in this session** and must be verified empirically after
  deployment (per the existing plan: check that audit-logged IPs are real
  client IPs, not Render's own internal address, using the same reasoning
  already encoded in
  [trust-proxy.spec.ts](../../apps/api/test/trust-proxy.spec.ts)).
- **HTTPS termination**: handled entirely at Render's edge once a custom
  domain is attached; the Nest process itself never holds a certificate.
- **Environment secrets**: set per-service in Render's dashboard
  (Environment tab), encrypted at rest (AES-128 minimum, confirmed) and in
  transit (TLS 1.2+, confirmed). Render's own guidance warns that a secret
  printed to stdout/stderr by the app itself will still appear in plaintext
  in Render's log viewer — ordinary logging hygiene, not a platform gap.
- **Health checks**: Render supports a configurable **Health Check Path**
  per web service (confirmed —
  [render.com/docs/health-checks](https://render.com/docs/health-checks)).
  Recommend pointing this at the app's existing `/health` endpoint, which
  already checks database, queue, and storage connectivity — Render then
  avoids routing traffic to an instance that fails this check.
- **Application restarts**: Render automatically restarts a crashed
  process and, once the Health Check Path above is configured, will not
  send traffic to an instance failing that check until it recovers —
  standard PaaS behavior, no custom code required.

---

## 11. What AgileWorks needs to purchase or create vs. what Claude can configure later

| Action | Who does it |
|---|---|
| Create the Render account, Upstash account, Cloudflare account, and Google Cloud project/billing | **AgileWorks** (account creation, billing details, and identity verification cannot be delegated) |
| Register/renew the pilot's domain | **AgileWorks** (payment + registrant identity) |
| Approve the specific paid tiers/instance sizes in §1–2 | **AgileWorks** (spending decision) |
| Generate the Postgres role passwords, JWT secrets, R2 API token, Vertex AI service-account key | Can be **Claude-assisted at configuration time**, once accounts exist — values are entered directly into each platform's secret store, never displayed in chat or committed to git |
| Run `provision-roles.sql` / `grant-runtime-privileges.sql` against the new database | **Claude can run this**, once given a live, credentialed connection string by the account owner |
| Set environment variables in Render's dashboard | **AgileWorks performs the entry** (Claude cannot access Render's dashboard); Claude can provide the exact list and values to paste |
| `prisma migrate deploy` + seed script against the new database | **Claude can run this**, once connected |
| DNS record creation at the registrar | **AgileWorks** (registrar account access) |
| Configure Render's Health Check Path, `TRUST_PROXY_HOPS`, and verify the real hop count post-deploy | **Joint** — Claude can identify the exact values and verify behavior via logs; AgileWorks clicks the dashboard toggle |

---

## 12. Remaining deployment risks

1. **Gemini 2.5 Flash's earliest possible retirement (Oct 16, 2026) is
   inside the likely pilot window** — see §4. Not a hosting risk, but a
   real operational one that should be tracked independently of this
   approval.
2. **Several Render figures in this document are secondary-sourced**
   (exact Web Service/Postgres instance pricing, paid-tier bandwidth
   allowance, and the precise `TRUST_PROXY_HOPS` value) because Render's
   pricing page did not return usable content to automated fetching in this
   session. These should be confirmed on render.com directly before final
   sign-off on cost.
3. **R2's Singapore placement is a best-effort location hint, not a
   guarantee** (§7) — acceptable today, worth revisiting if a data-residency
   commitment is ever made to a customer.
4. **The Postgres external-access restriction setting is a real
   configuration step, not a default** — must be explicitly set at
   provisioning time, not assumed from this document (§9).
5. **No real usage data exists yet** — every usage-dependent figure in §3
   is an estimate and should be replaced with actual Google Cloud/Upstash/R2
   billing data after the pilot's first couple of weeks.

---

## 13. Recommendation: **GO WITH CONDITIONS**

The Architecture A stack named above is sound, low-cost, and satisfies all
three outstanding Phase 7 P0 network-exposure requirements by the chosen
providers' own defaults. It is not an unconditional GO because two classes
of open items remain that this document could not close on its own:

- **Condition 1**: Confirm the secondary-sourced Render figures (§2, §12.2)
  directly on render.com/pricing before final budget sign-off — expected to
  move the total by at most a few dollars/month, not change the
  recommendation.
- **Condition 2**: Explicitly set Render Postgres's external-access
  restriction at provisioning time (§9) — this is a checkbox/setting to
  exercise, not a blocker to approval, but must not be skipped.
- **Condition 3**: Acknowledge the Gemini 2.5 Flash retirement timeline
  (§4/§12.1) as a tracked risk independent of this hosting decision, with a
  fallback plan ready before go-live.

None of these require a different architecture, a different provider, or
more research to resolve — they are pre-deployment checklist items, not
open design questions. **No provisioning has occurred. Awaiting approval
before any account is created or resource is purchased.**
