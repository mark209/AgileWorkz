# Pre-Provisioning Gate Review — Architecture A

**Status: REVIEW DOCUMENT ONLY.** No resources provisioned, no accounts
created, no DNS changed, no credentials created, nothing deployed, no
production code modified. This is the final gate review requested before
provisioning approval for Architecture A, following
[phase7-p0-architecture-a-cost-proposal.md](./phase7-p0-architecture-a-cost-proposal.md).
Research performed 2026-08-31; every figure is labeled by source
confidence, as before.

---

## 1. Gemini 2.5 Flash retirement — successor model & qualification design

### What was found

Model-version churn in the Gemini 3.x line has been rapid enough this
session that third-party pricing/spec aggregators disagree with each other
and, in places, with Google's own documentation pages. The findings below
separate primary-source (`docs.cloud.google.com`, `ai.google.dev`) facts
from secondary-sourced claims that need direct confirmation.

| Model | GA/Preview | Confirmed regions | Notes |
|---|---|---|---|
| **Gemini 2.5 Flash** (current) | GA | `asia-southeast1` (already the Phase 5-approved region) | Earliest possible retirement **October 16, 2026** — confirmed via Google's own user notifications |
| **Gemini 3 Flash** | **Preview** (confirmed, two independent sources) | Not confirmed for `asia-southeast1` | Excluded from consideration below — a private pilot's OCR pipeline should not depend on a Preview-tier model, which carries weaker deprecation-notice guarantees than GA |
| **Gemini 3.1 Flash-Lite** | GA (confirmed) | **Not confirmed** — a Google Developer Forums thread title itself ("Gemini 3.1 flash lite US availability in vertex ai") suggests region rollout has been uneven | Positioned by Google as the cost-efficient, high-volume successor tier — the closest match to Gemini 2.5 Flash's role in this pipeline, but "Lite" may trade off some multimodal/reasoning depth versus standard Flash — **unconfirmed for this use case** |
| **Gemini 3.7 Flash** | GA since Aug 13, 2026 (confirmed) | **Confirmed GA regions: "global, us, and eu" — `asia-southeast1` is not in that list** (per Google Cloud's own Gemini Enterprise Agent Platform docs) | Full standard-tier multimodal reasoning model (text/image/video/PDF/audio input, confirmed structured JSON output support) — capability-wise the closer match to 2.5 Flash, but **the region gap is a real, named blocker to using it under the current approved design**, not a minor caveat |

**This document does not pick a final successor model** — the evidence is
genuinely mixed, and `extraction-config.ts`'s own design comment already
anticipated exactly this situation:

> *"the model must be configured explicitly — this is deliberately never
> defaulted or hard-coded, per the approved design's Decision 1 (**exact
> model availability in the target region must be verified live before it
> is set**)."*

**Required next step, before any model decision:** check the Vertex AI
Model Garden console directly, for the `agileworks-hvac-erp` GCP project,
filtered to `asia-southeast1` — this is the one authoritative source, and
it is a zero-cost, side-effect-free lookup (viewing the console provisions
nothing). Web search results about a fast-moving, weeks-old model rollout
are not a substitute for this. **If no suitable GA multimodal model is
confirmed available in `asia-southeast1` by the time this matters, that is
itself a decision the project owner must make explicitly (accept a
different region, or wait) — not something to default around.**

### Answering the specific questions asked, for the two GA candidates

| Question | Gemini 3.1 Flash-Lite | Gemini 3.7 Flash |
|---|---|---|
| GA/Preview | GA | GA |
| `asia-southeast1` | Unconfirmed | **Confirmed regions do not include it** |
| Multimodal image/PDF | Expected (standard Gemini family capability) — unconfirmed for the Lite tier specifically | **Confirmed** — text, image, video, PDF, audio input |
| Structured JSON output | Expected (long-standing Gemini feature) — not separately confirmed for this model | **Confirmed** — `responseSchema`/`response_format` supported |
| Pricing vs. 2.5 Flash ($0.30/$2.50 per 1M in/out) | Not found from a primary source in this session | Introductory: $0.75/$3.75 per 1M in/out through 2026-12-31, then $1.50/$7.50 standard from 2027-01-01 — **roughly 2.5–3× more expensive per token than 2.5 Flash**, though still a small absolute dollar amount at pilot volume (see §3 of the prior cost proposal) |
| API differences affecting `vertex-gemini.provider.ts` | **None expected.** The client already calls `generateContent({ model: this.config.modelId, ... })` with `modelId` fully config-driven ([vertex-gemini.provider.ts:278-288](../../apps/api/src/common/extraction/providers/vertex-gemini.provider.ts#L278-L288)), and `responseSchema`/`responseMimeType: "application/json"` is a standard, model-agnostic call shape. Migrating models is expected to be **a `VERTEX_AI_MODEL_ID` value change only** — no code change — *provided* the successor model honors the same structured-output contract, which must be verified by the qualification test below, not assumed. |
| Can existing prompts be reused? | Expected yes — the prompt is plain text plus the same `EXTRACTION_RESPONSE_SCHEMA`, nothing 2.5-Flash-specific in its construction | Same expectation, same caveat — reuse the prompt unchanged for the qualification test itself; that test is exactly what confirms whether it should stay unchanged in production |
| Expected migration effort | **One env var, if qualification passes.** The real effort is entirely in the qualification test (§ below), not the code change. | Same |

### Model qualification test design (design only — not executed, no code changed)

**Core principle, directly answering the requirement:** *extraction accuracy
on Gemini 2.5 Flash must never be assumed to transfer to a successor model.*
This project already has two real, reusable assets from Phase 5 to build
this on — reused as-is, no code changes:

1. **A real, human-sourced 21-document corpus** — the exact documents
   already used for Stage C.1 production validation
   ([run-production-validation-batch.ts](../../apps/api/scripts/run-production-validation-batch.ts)),
   including the specific documents (`MR0101`, `MR0153`) where Phase 5's own
   process previously surfaced and resolved a real extraction ambiguity.
   This script already takes `VERTEX_CONFIG.modelId` as a plain constant —
   running it a second time with only that one value changed, against the
   same 21 real files, is not a code change to production, it is invoking
   an existing validation script with a different parameter.
2. **A formal, ground-truth-scored acceptance harness**
   ([run-acceptance-test.ts](../../apps/api/src/common/extraction/acceptance-test/run-acceptance-test.ts) +
   [scoring.ts](../../apps/api/src/common/extraction/acceptance-test/scoring.ts))
   with the exact numeric targets Phase 5 already approved
   (`PILOT_ACCEPTANCE_TARGETS`: 98% printed-text accuracy, 95% handwritten-
   numeric accuracy, 98% value/unit preservation, 95% checkbox accuracy, 95%
   equipment-row association, 95% taxonomy-suggestion accuracy, **0%
   hallucination**).

**Proposed two-tier test:**

- **Tier 1 — fast comparative screen (no new ground-truth authoring):** run
  the existing 21-document production-validation script twice — once
  against `gemini-2.5-flash` (the current baseline) and once against the
  confirmed-available successor — and diff the two runs field-by-field on
  the same real documents. Flag every field where the two models disagree,
  with priority review on the fields Phase 5's own history already found
  fragile (indoor/outdoor taxonomy mapping, S/D abbreviation handling,
  checkbox extraction, blank-field hallucination, and the MR0101/MR0153
  paired-value case specifically). This tier catches gross regressions
  cheaply and reuses 100% existing tooling.
- **Tier 2 — the real gate:** for a representative subset of that corpus
  (the original Stage B 4-document set is the natural choice, since Phase 5
  already invested in understanding those documents deeply), prepare or
  reconfirm `GroundTruthDocument[]` ground truth by human transcription —
  never derived from either model's own output, per the existing
  methodology's own rule — and run **both** models through
  `runAcceptanceTest()` against the **same, already-approved
  `PILOT_ACCEPTANCE_TARGETS`**. **The successor model must meet or exceed
  Gemini 2.5 Flash's own measured scores on this same corpus before it is
  approved to replace it in `VERTEX_AI_MODEL_ID`.** A successor that is
  merely "probably fine" on general benchmarks is not sufficient — it must
  clear this project's own bar, on this project's own document types.

**This is a design, not an execution** — running it requires live Vertex AI
credentials and API calls, which this review does not perform. It should
run as its own tracked workstream, independent of and in parallel with
infrastructure provisioning, with a hard deadline before **October 16,
2026**.

---

## 2. Render PostgreSQL — verified plan specification

Two additional official Render documentation pages were checked this pass,
narrowing several figures that were only secondary-sourced before.

| Spec | Value | Confidence |
|---|---|---|
| RAM (smallest paid tier, "Starter"/Basic-256mb equivalent) | 256 MB | **Confirmed** via Render's own legacy-instance-type table — the current "Basic-256mb" tier is presumed equivalent in compute spec, since Render's 2024 pricing refresh separated storage from compute billing without stated compute-spec changes |
| RAM (next tier up, "Standard"/Basic-1gb equivalent) | 1 GB | Same confidence basis |
| CPU | 0.1 vCPU (256 MB tier), 1 vCPU (1 GB tier) | Confirmed via the same legacy table; **not separately confirmed for the current-generation Basic-XXmb tier names** |
| Storage | Legacy bundled amounts were 1 GB (256 MB tier) / 16 GB (1 GB tier); **current flexible-compute billing separates storage from compute** — likely a smaller included amount (secondary sources suggest ~1 GB included) with $0.30/GB/month overage | **Not fully confirmed** — verify exact current included storage at render.com/pricing |
| Connection limit | **100 connections** for any instance under 8 GB RAM (confirmed, current docs) — consistent with the legacy table's own "97" figure for the same tier class | **Confirmed**, two independent official Render pages agree |
| Backup policy | Logical (`pg_dump`-style) backups retained 7 days regardless of plan; **point-in-time recovery ships on every paid instance**, with the recovery window set by workspace plan (3 days on Hobby, 7 days on Pro+) — reconfirmed this pass, unchanged from the prior document | **Confirmed**, official docs |
| Singapore region | Available | **Confirmed** (Render publishes Singapore as one of 5 regions) |
| Monthly price | ~$7 (256 MB) / ~$20 (1 GB) | Secondary-sourced, consistent across three independent sources this session, but Render's own live pricing page could not be scraped directly — **verify before purchase** |
| Upgradable without rebuilding the app | **Yes, expected** — Render's flexible-compute model is described as letting compute and storage be resized independently via the dashboard; this is a platform-level database operation, not an application deploy, and should not require touching `apps/api`'s build or code | Reasonable inference from documented platform behavior, not a direct confirmation of zero-downtime specifics — a brief restart during resize should be assumed |
| External/public access restriction possible | **Yes — but not the default.** Render's own docs state plainly: *"by default, your Render Postgres instance is accessible from any IP address (if the connection uses valid credentials)."* An IP allow-list (CIDR-based) must be explicitly configured, or external access disabled entirely (`--clear-ip-allow-list`), to close this | **Confirmed, official docs — and this is a real action item, not a default to rely on** |

### Is 256 MB / 1 GB realistically sufficient? — **Revised recommendation**

**No — start at 1 GB (Basic-1gb), not 256 MB, from day one.** This
reverses the prior document's "start small, upsize later" framing for one
concrete reason found in this project's own data: this session's own
development/test activity alone produced **23,701 `audit_logs` rows** —
the schema audits nearly every write across 49 tables (customers, sites,
equipment, quotations, work orders, service reports, the six
`extraction_*` OCR staging tables, and more). A real pilot with 3–25 active
users doing daily work will accumulate meaningful audit volume within
weeks, and 256 MB leaves Postgres very little headroom (`shared_buffers`,
`work_mem`, query planning) once queries start joining against a
growing `audit_logs` table alongside the rest of the schema. 1 GB is a
modest, cheap (~$13/month more) correction that removes a real risk of
the pilot outgrowing its database tier within the first weeks.

**Cost impact of this correction:** the fixed monthly baseline in the prior
proposal rises from ~$47/mo to ~$60/mo **starting immediately**, not only
once "GROWTH" is reached — this document supersedes that earlier
LOW/NORMAL fixed-cost figure specifically on this point.

---

## 3. Cloudflare R2 residency — recorded explicitly, and compared

**Recorded, as requested: R2's `apac` location hint is best-effort only.**
Cloudflare's own documentation states location hints are *"best effort and
not a guarantee"* — only Cloudflare's separate *jurisdiction* feature (EU,
FedRAMP, US — no APAC/Singapore jurisdiction exists) provides a binding
guarantee, and Singapore is not one of the enforceable jurisdictions R2
offers at all. **R2 cannot currently provide a contractually guaranteed
Singapore data residency claim, under any configuration.** This document
does not replace R2 — it records this limitation plainly, as instructed.

### Cost comparison: R2 vs. DigitalOcean Spaces (SGP1 — a real, named Singapore region)

Both are S3-API-compatible with the existing `S3StorageProvider` — either
is a pure configuration change (5 env vars), never a code change.

| Storage volume | Cloudflare R2 (`apac` hint, best-effort) | DigitalOcean Spaces SGP1 (guaranteed Singapore) |
|---|---|---|
| 10 GB | **~$0.00–0.15/mo** (inside or at the edge of the 10 GB free allowance) | **$5.00/mo** flat (well inside the 250 GiB included allotment) |
| 50 GB | **~$0.60/mo** (40 GB × $0.015/GB beyond the free 10 GB) | **$5.00/mo** flat (unchanged — still inside 250 GiB) |
| 100 GB | **~$1.35/mo** (90 GB × $0.015/GB beyond the free 10 GB) | **$5.00/mo** flat (unchanged — still inside 250 GiB) |

(Operation charges and egress are negligible-to-zero on both at this
volume — R2 has no egress fee at all; DO Spaces includes 1 TiB egress in
the same flat fee.)

**The pattern holds across the entire range checked: R2 remains cheaper by
$3.65–5.00/month at every tier from 10 GB to 100 GB**, and DO Spaces' price
does not change at all across this range since it's all inside one flat
allotment. **Recommendation unchanged from the prior document: stay on R2
for the pilot** (no stated residency requirement exists today), and treat
DO Spaces SGP1's ~$5/month as the known, small, ready-to-execute cost of
switching the moment a real contractual or regulatory Singapore-residency
requirement appears.

---

## 4. Deployment gate — Phase 7 P0 requirements reconfirmed

| Requirement | Classification | Basis |
|---|---|---|
| Upload magic-byte content validation | **READY IN CODE** | Implemented and tested this Phase (`file-signature.util.ts` + unit/e2e tests), unchanged since |
| Redis authenticated/non-public (app-side mechanism) | **READY IN CODE** | `parseRedisUrl` correctly extracts credentials + TLS from `rediss://`, tested; Upstash itself has no unauthenticated mode by provider design |
| Object-storage credential handling | **READY IN CODE** | `S3StorageProvider` is fully env-driven, no hardcoded credentials, boot-time-validated when `STORAGE_PROVIDER=s3` |
| `TRUST_PROXY_HOPS` (app-side mechanism) | **READY IN CODE** | Implemented as a configurable hop count (not a blind `true`), tested against spoofing in `trust-proxy.spec.ts` |
| Environment-secret handling (app-side mechanism) | **READY IN CODE** | Every credential is an env var, none hardcoded, Joi-validated at boot |
| Backup/restore procedure | **READY IN CODE** *(procedure proven, not yet scheduled anywhere live)* | `pg_dump`/`pg_restore` and object-storage mirror both actually executed and verified against real dev data this Phase; confirmed compatible with Render Postgres specifically in §2 above |
| PostgreSQL credentials + network restriction | **REQUIRES DEPLOYMENT CONFIGURATION** | Credential support is code-ready; **network restriction is explicitly not the default** on Render (§2) — the IP allow-list/external-access setting must be deliberately configured at provisioning time |
| `TRUST_PROXY_HOPS` exact value for the chosen platform | **REQUIRES DEPLOYMENT CONFIGURATION** | The mechanism is ready; the correct numeric value for Render's specific edge topology is still unconfirmed and must be verified empirically post-deploy |
| HTTPS/TLS termination | **REQUIRES DEPLOYMENT CONFIGURATION** | Mechanism (Render's automatic edge cert) is confirmed available; requires an actual domain attached to an actual service to activate — cannot exist before deployment |
| Redis/object-storage/Postgres — actual provisioning | **REQUIRES DEPLOYMENT CONFIGURATION** | Code-side readiness confirmed above; the instances themselves don't exist yet |
| Gemini 2.5 Flash successor model | **REQUIRES MODEL MIGRATION/VALIDATION** | See §1 — a live, credentialed qualification test against a region-confirmed GA successor, not yet performed |
| — | **No BLOCKER items identified** | Every open item above is an actionable, well-understood deployment or validation step — none require reconsidering the architecture, the provider stack, or the storage abstraction |

---

## 5. Final table

| Issue | Current status | Required action | Est. cost impact | Blocks provisioning? |
|---|---|---|---|---|
| Gemini 2.5 Flash retirement (Oct 16, 2026 earliest) | No successor selected; candidates identified with mixed region confirmation | Check Vertex AI Model Garden console directly for `asia-southeast1` GA availability; run the two-tier qualification test (§1) against whichever model is confirmed | ~$0–15/mo more if successor pricing is ~2–3× 2.5 Flash's per-token rate — still small at pilot OCR volume | **No** — independent workstream with its own Oct 16 deadline; does not block hosting provisioning |
| Render Postgres tier (256 MB vs. 1 GB) | Prior proposal assumed 256 MB was adequate for LOW/NORMAL | Provision **Basic-1gb from day one**, not Basic-256mb | **+$13/mo**, effective immediately (not just at GROWTH) | No — a plan-selection correction, not a blocker |
| Render Postgres external access defaults to open | Confirmed: any IP + valid credentials can connect by default | Explicitly configure an IP allow-list or disable external access at provisioning time | $0 | No — but **must not be skipped**, or Phase 7 P0's network-isolation requirement is silently violated at deployment |
| `TRUST_PROXY_HOPS` exact value on Render | Assumed 1, unconfirmed | Verify empirically post-deploy (audit-logged IPs vs. real client IPs) | $0 | No |
| R2 Singapore residency is best-effort only | Recorded (§3) | Accept for pilot; monitor for any future contractual/regulatory residency requirement | $0 now; ~$5/mo if switched to DO Spaces SGP1 later | No |
| Several Render figures still secondary-sourced (exact tier price, storage-included amount) | Unchanged from prior review | Confirm directly at render.com/pricing before final purchase | Expected to move total by a few $/month at most | No |

---

## Recommendation: **GO WITH CONDITIONS**

No blocker was found. Architecture A's provider stack remains sound. Four
conditions gate final execution, none of which require reconsidering the
architecture:

1. **Provision Render Postgres at Basic-1gb, not Basic-256mb**, correcting
   the prior cost estimate by +$13/month effective immediately.
2. **Explicitly configure Render Postgres's external-access restriction**
   (IP allow-list or disabled external access) at provisioning time — this
   is confirmed to not be the default.
3. **Run the model-qualification test in §1 against a region-confirmed GA
   successor before October 16, 2026**, as an independent workstream that
   can proceed in parallel with (or after) infrastructure provisioning —
   it does not block provisioning itself, but must clear before removing
   `gemini-2.5-flash` from the live configuration.
4. **Verify the remaining secondary-sourced Render figures and the exact
   `TRUST_PROXY_HOPS` hop count** at signup/post-deploy, as already noted
   in the prior cost proposal.

**No provisioning, account creation, DNS change, or credential creation has
occurred. Awaiting approval before proceeding.**
