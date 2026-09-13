# Phase 7 — V1 Pilot Launch Checklist

**Status: CHECKLIST — action items, not yet executed.** This document tracks
what remains before the first real pilot user is onboarded, based on the
actual current repository (`HEAD` at time of writing: `15397dc`) and the
live production topology recorded in
[phase7-p0-production-readiness-verification.md](./phase7-p0-production-readiness-verification.md).

This is a superset of the 13 Phase 7 P0 requirements (all of which are
PASS) — it adds the operational, RBAC, and data-quality checks needed
specifically for real pilot users, including one item (the synthetic
production E2E test) that was never part of the formal P0 requirement set
but is treated here as a required final operational validation.

V1.1-scoped items (the approved
[dashboard KPI enhancement](./dashboard-management-kpis-requirement-and-audit.md))
are deliberately **not** included below — they remain out of scope for V1
launch by design.

---

## Already complete

| Area | Status | Evidence |
|---|---|---|
| Phase 7 P0 security/infra requirements (all 13) | **DONE** | All PASS — see the verification doc |
| Backup — production Cron Job | **DONE** | First live run 2026-09-13: `pg_dump` → R2 upload → verified → heartbeat, all PASS |
| Backup — restore validation | **DONE** | 2026-09-13: isolated PostgreSQL 18 restore, 52 tables, all 17 migrations matched, zero warnings/errors |
| Database schema / migrations | **DONE** | 17 Prisma migrations applied in production; `prisma migrate status` reports up to date |
| Production seed — Admin/Owner bootstrap user | **DONE** | Seed run by operator; Admin/Owner login verified on `web` and `field` |
| `/health` endpoint (point-in-time) | **DONE (2026-09-10)** | Returns `ok: true`, database/queue/storage sub-checks green — re-check before launch, see Section A |
| TLS/HTTPS | **DONE** | Render edge-terminated on all three services |
| `TRUST_PROXY_HOPS` | **DONE** | Empirically verified against real client IP |

---

## A. Required before first pilot user

**A1. API deployment/commit synchronization**
- [ ] Confirm which commit is actually deployed on `agileworks-erp-api` (Auto-Deploy is Off — check Render's "Events" tab for the deployed commit SHA).
- [ ] If it predates the current `main` (`15397dc`), trigger a manual deploy so the running API matches reviewed code.
- [ ] Repeat the commit check for `agileworks-erp-web` and `agileworks-erp-field`.

**A2. Web app readiness**
- [ ] Load `https://agileworks-erp-web.onrender.com` cold (no cache) and confirm it renders without console errors.
- [ ] Confirm it is running the intended deployed commit (A1).

**A3. Field app readiness**
- [ ] Load `https://agileworks-erp-field.onrender.com` cold and confirm it renders.
- [ ] Re-confirm the previously-observed role-gated behavior (non-Technician account correctly shown the "not a Technician account" state) still holds after any redeploy from A1.

**A4. Production authentication/login**
- [ ] Re-confirm Admin/Owner login succeeds on both `web` and `field` after any redeploy from A1 (last verified 2026-09-10 — not assumed to still hold after a redeploy).
- [ ] Confirm logout / token-refresh behavior at least once (not previously exercised in the verification record).

**A5. Production RBAC smoke tests — Admin/Owner, Manager, Office Staff, Technician**
- [ ] **Gap:** `prisma/seed.ts` seeds all four roles and their permission grants ([prisma/seed.ts:56](../../prisma/seed.ts:56)), but only **one bootstrap user** (Admin/Owner) currently exists in production. No Manager, Office Staff, or Technician user has been created yet.
- [ ] Create one real (or clearly-labeled test) user per role.
- [ ] Smoke-test each role's access boundary against production: Technician can `read_own`/`start_own` work orders but not see others'; Office Staff can create/update quotations but not approve/reject; Manager can approve/reject and lock service reports; Admin/Owner has full access.
- [ ] This has not yet been exercised against live production RBAC — only Admin/Owner has been.

**A6. Database / Redis / R2 / Vertex connectivity**
- [ ] Database and Redis — re-confirm current `/health` status (last recorded 2026-09-10).
- [ ] R2 backup bucket (`agileworks-erp-backups`) — already confirmed working 2026-09-13.
- [ ] R2 application document bucket (`agileworks-erp-documents`) — configuration verified (private, signed-URL-only, correctly scoped token), but no real upload has been exercised in production yet — covered by A8.
- [ ] Vertex AI — credential presence confirmed, but no real Vertex AI call has been made in production yet — covered by A8.

**A7. `/health` status**
- [ ] Re-run `/health` immediately before onboarding the first pilot user — the last recorded check (2026-09-10) is a point-in-time signal, not a standing guarantee.

**A8. Controlled synthetic production E2E test — required final operational validation**
- [ ] Upload one clearly-labeled, non-real, non-customer test Service Report through the real technician-facing path, as a genuine authenticated production request.
- [ ] Confirm it flows: **upload → OCR extraction (real Vertex AI call) → human verification → confirmation**, exactly as the production pipeline is designed to run.
- [ ] Confirm extracted data lands correctly in the verification UI, a human reviewer can edit/verify it, and "Confirm" transitions the record to its terminal confirmed state.
- [ ] Confirm the underlying object is written to `agileworks-erp-documents` in R2 and is retrievable only via a signed URL, never publicly.
- [ ] Confirm an idempotent retry (same Idempotency-Key, same payload) does not create a duplicate record — this is the first real-production exercise of the F7.1 idempotency-key validation and the magic-byte upload content validation, both of which are currently code-verified only (see [phase7-p0-production-readiness-verification.md](./phase7-p0-production-readiness-verification.md) requirement #2's evidence note).
- [ ] Note: this is a real, small, billed Vertex AI call — not free, not simulated.
- [ ] Decide whether to keep the test record labeled as a test record or delete it afterward, so it doesn't pollute pilot reporting.

**A9. Production reference data and `system_settings` verification**
- [ ] Confirm reference-data tables seeded alongside roles/permissions (equipment types, measurement types/stages, problem types, inquiry sources/types, trades, signoff roles, service report types, etc. — all present with non-zero row counts per the 2026-09-13 restore-test snapshot) reflect real, reviewed business data, not placeholder values.
- [ ] Confirm `system_settings` values (e.g. `vat_rate_percent`, quotation approval thresholds) are set to real operating values, not defaults.

**A10. Monitoring — pre-launch pass**
- [ ] One-time review of Render logs across all three services for recurring warnings/errors not surfaced by `/health` (slow queries, retry storms, unhandled promise rejections).
- [ ] Confirm Render's failed-deploy/failed-run notifications and the healthchecks.io backup alert are both routed to a channel/email someone actually watches.

---

## B. Recommended / non-blocking

| Item | Why it's non-blocking |
|---|---|
| External uptime monitoring on `https://agileworks-erp-api.onrender.com/health` | A free external check adds monitoring coverage from outside Render's network, but Render + healthchecks.io already cover the backup path, and its absence doesn't put pilot data or availability at meaningfully higher risk on day one. |

---

## C. Scheduled post-launch follow-up

| Item | Status | Deadline |
|---|---|---|
| OCR successor-model qualification (`gemini-2.5-flash` retirement) | Not started — explicitly deferred | Before **2026-10-16** (earliest possible retirement date per Google's own notification). Run the two-tier qualification test ([pre-provisioning gate review](./phase7-p0-pre-provisioning-gate-review.md) §1) against the existing 21-document Phase 5 corpus before this date. Not a V1 launch blocker, but a hard-dated follow-up that must not slip past its window. |

---

## Explicitly out of scope for this checklist

- V1.1 Dashboard KPI enhancement — separately approved and scoped in [dashboard-management-kpis-requirement-and-audit.md](./dashboard-management-kpis-requirement-and-audit.md); deliberately excluded from V1 launch to avoid delaying it.
- DNS / custom domain — deliberately untouched.
- Wave 2 / public-production hardening — not started.
- Real customer data — not entered.
