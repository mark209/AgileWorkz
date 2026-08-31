# Phase 5 Step 5 — Human Verification Workflow

**Status: APPROVED / FROZEN.** No further changes to the verification data
model, RBAC grants, bulk-confirm eligibility rule, completion rule, or
audit approach are to be made without explicit approval. This document is
the durable record — the working history lived only in conversation until
now.

## Scope

Covers the "Human Verification" stage of the Phase 5 pipeline defined in
`rev7-blueprint-summary.md`:

```
Original Document → OCR/AI Extraction → Extraction Staging
  → Human Verification [frozen here] → Confirm Report
  → Canonical Service Report Data → LOCKED
```

Everything upstream (OCR/AI Extraction, Extraction Staging) is covered by
`phase5-extraction-reliability-baseline.md` and was not modified by this
work except where explicitly noted below. Everything downstream (Confirm
Report, Lock) is now built and frozen too — see
`phase5-step6-confirm-baseline.md` and `phase5-step7-lock-baseline.md`.
Phase 5 — Service Report Intake is complete.

## Approved architecture (frozen)

### Field-level review

Each of the six staging tables (`extraction_basic_info`,
`extraction_equipment_units`, `extraction_problems`,
`extraction_measurements`, `extraction_narrative_items`,
`extraction_signoffs`) carries `review_status` (`ExtractionReviewStatus`,
human-set only) alongside the AI-written `ai_value`/`ai_confidence`/
`requires_human_verification` columns. A reviewer resolves one staged field
via exactly one of four actions:

- **Confirm** — `reviewStatus = CONFIRMED`, `verifiedValue` copied from `aiValue`.
- **Correct** — `reviewStatus = CORRECTED`, `verifiedValue` set to the
  reviewer's typed value, distinct from and never overwriting `aiValue`.
- **Confirm Blank** — `reviewStatus = CONFIRMED_BLANK`, `verifiedValue` stays null.
- **Needs Follow-Up** — `reviewStatus = NEEDS_FOLLOW_UP`; blocks report
  completion until resolved into one of the other three statuses.

**Immutability guarantee**: `aiValue`, `aiConfidence`, `aiUnit`,
`suggestedMeasurementTypeCode`, and the original uploaded document
(`documentFileKey`/mime/name/size) are never written by any verification
code path — only the extraction pipeline (`ocr_worker`, per
`ocr-worker-db-isolation.md`) writes them, and only once. Verification
writes exclusively to `reviewStatus`/`verifiedValue`/`verifiedBy`/
`verifiedAt`.

### Bulk-confirm eligibility (`isEligibleForBulkConfirm`, mirrored
identically in backend and frontend)

```
aiValue !== null
  && (aiConfidence === HIGH || aiConfidence === MEDIUM)
  && !requiresHumanVerification
  && reviewStatus === null
```

**LOW-confidence fields are explicitly excluded** — bulk confirmation is
HIGH/MEDIUM only. Blanks (`aiValue === null`), flagged fields
(`requiresHumanVerification`), unreadable fields (`aiConfidence ===
UNREADABLE`), and already-reviewed fields (`reviewStatus !== null`) are all
excluded. The UI previews the exact affected count ("Confirm N eligible
fields") before the reviewer commits, and re-prioritizes the remaining
attention-required fields immediately after.

### Report-level completion rule

`canCompleteVerification`: every staging row across all six categories must
have `reviewStatus !== null`, **and** none may be `NEEDS_FOLLOW_UP`. Both
conditions are enforced server-side (authoritative) and mirrored
client-side (button disabled + explanatory tooltip). A report with any
`NEEDS_FOLLOW_UP` field remains `PENDING_VERIFICATION` and cannot reach
`VERIFIED` — verified live end-to-end, including the specific case of
resolving a `NEEDS_FOLLOW_UP` field into a terminal status and then
successfully completing.

### Field display/attention model (`service-report-field-status.ts`)

Nine display states, each mapped to a distinct badge:
`needs-follow-up`, `unresolved` (unreadable), `requires-verification`
(AI-flagged), `low-confidence`, `blank`, `high-confidence`, `confirmed`,
`corrected`, `confirmed-blank`. Attention-ranked so unresolved/flagged
fields sort before safe/already-reviewed ones within each category section.

**Correction made during live verification**: the original implementation
had no distinct branch for `aiConfidence === LOW`, causing LOW-confidence
fields to render indistinguishably from `high-confidence` ones. Caught by
running the real application against seeded data (not just mocked tests),
fixed by adding the `low-confidence` state, an attention rank between
`requires-verification` and `blank`, and regression tests asserting a LOW
field is never classified `high-confidence`.

### RBAC

Unchanged from the Phase 5 baseline RBAC matrix (`prisma/seed.ts`
`service_reports.verify`): Technician structurally lacks this permission
(no verification access, web or field); Office Staff, Manager, and
Admin/Owner all hold it, role-based only — a verifier may act on a report
they themselves uploaded. Verification is web-only; `apps/field` was not
touched.

### Audit

Every individual field review and every bulk-confirm action writes an
`audit_logs` row via the existing `AuditService`
(`service_report_verification_field_reviewed`,
`service_report_verification_bulk_confirmed`,
`service_report_verified`), each carrying actor, timestamp, and
before/after state sufficient to reconstruct the action — bulk-confirm's
`afterData.fields` records the complete list of affected field IDs, not
just a count. No redesign of the audit mechanism was needed or made.

## Supporting additions (approved as necessary for the verification UI)

Two additions beyond the original Step 5 scope, both necessary to make the
web verification screen actually functional against real data:

- **`GET /service-reports?status=...`** — a verification-queue listing
  endpoint (defaults to `PENDING_VERIFICATION`), gated on the existing
  `service_reports.read` permission. No new permission was created.
- **`GET /storage/local/*`** — a signed, time-limited, `@Public()` document
  resolver for `LocalDiskStorageProvider` (the S3 provider already produces
  a fetchable presigned URL; local-disk previously did not, returning an
  unusable `local-storage://` pseudo-URL that had no HTTP route resolving
  it — dead code since it was written). Signature verification uses HMAC
  with `crypto.timingSafeEqual`, guarded against a buffer-length-mismatch
  crash on malformed input (returns 403, not 500). This is the only
  unauthenticated route in the application; it is scoped to a signed,
  expiring token per object key, matching the security posture the S3
  presigned-URL path already has.

## Test baseline (frozen reference point)

| Suite | Result |
|---|---|
| Backend unit | 292/292 passing |
| Backend E2E | 184/184 passing |
| Frontend (Vitest) | 33/33 passing |
| Frontend typecheck (`tsc --noEmit`) | clean |
| Frontend lint (`next lint`) | clean |

Frontend test infrastructure (Vitest + React Testing Library) was
introduced for the first time in this repo as part of this step
(`apps/web/vitest.config.ts`, `vitest.setup.ts`).

Live end-to-end verification was additionally performed against the real
running application (real backend, real seeded data spanning all nine
field display states) — not mocked: the LOW-confidence bug above was found
this way, and all four review actions, bulk-confirm preview/apply, and the
full completion-blocking → completion-succeeding sequence were exercised
against the live app and observed to behave correctly.

## Known pre-existing limitation carried forward (not a Step 5 defect)

**In-memory authentication.** `AuthProvider` (`apps/web/src/lib/auth-context.tsx`)
holds the access token and user object in React state only — a deliberate
Phase 1 XSS-mitigation trade-off, not something Step 5 introduced or is
scoped to fix. A hard page reload (not client-side navigation) requires
signing in again; this affected only the *testing technique* used during
live verification (client-side link navigation was required to preserve
the session), not the correctness of any verification behavior. `auth_sessions`
(`auth-sessions-design.md`) is the already-approved-in-principle design for
stateful refresh-token session management; it does not by itself change the
in-memory access-token behavior. **This should be addressed before
production deployment** but is explicitly out of scope for Step 5 per
instruction, and no authentication change was made in this step.

## Change control

No further changes to the verification data model, the bulk-confirm
eligibility rule, the completion rule, the field display/attention
taxonomy, or the RBAC grants above without explicit approval. The frozen
Step 1–4 extraction/consensus/taxonomy architecture
(`phase5-extraction-reliability-baseline.md`) was not modified by this
work.
