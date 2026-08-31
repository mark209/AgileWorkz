# Phase 5 Step 7 — Lock

**Status: APPROVED / FROZEN.** No further changes to the `CONFIRMED →
LOCKED` transition rule, RBAC grants, transaction/idempotency mechanism, or
the queue-discoverability behavior below without explicit approval. This
document is the durable record — the working history lived only in
conversation until now.

**This is also the final step of Phase 5 — Service Report Intake is now
COMPLETE / FROZEN.** See "Phase 5 complete" at the end of this document.

## Scope

Covers the final "LOCKED" stage of the Phase 5 pipeline defined in
`rev7-blueprint-summary.md`:

```
Original Document → OCR/AI Extraction → Extraction Staging
  → Human Verification → Confirm Report → Canonical Service Report Data
  → LOCKED [frozen here]
```

Upstream stages are covered by `phase5-extraction-reliability-baseline.md`
(Steps 1–4), `phase5-step5-verification-baseline.md` (Step 5), and
`phase5-step6-confirm-baseline.md` (Step 6) — none of which was modified by
this work.

## Objective

Provide the final, terminal administrative action on a Service Report:
`CONFIRMED → LOCKED`. Unlike Confirm, Lock never reads staging data, never
resolves any mapping, and never writes to any canonical detail table — it
is a pure status/actor/timestamp transition that closes out the pipeline.

## Final Service Report lifecycle (Phase 5, complete)

```
PENDING_EXTRACTION → (EXTRACTION_FAILED |) PENDING_VERIFICATION
  → VERIFIED → CONFIRMED → LOCKED
```

- `PENDING_EXTRACTION` / `EXTRACTION_FAILED`: Steps 1–4 (OCR/AI extraction).
- `PENDING_VERIFICATION` → `VERIFIED`: Step 5 (Human Verification) — every
  staging field reviewed, none `NEEDS_FOLLOW_UP`.
- `VERIFIED` → `CONFIRMED`: Step 6 (Confirm) — the only writer of canonical
  `service_report_*` detail tables.
- `CONFIRMED` → `LOCKED`: Step 7 (this document) — terminal, forward-only.

## Approved architecture (frozen)

### Transition rule

Valid only from `status = CONFIRMED`. Rejected (with a clear `400`
message identifying the actual current status) from every other status,
including a second attempt on an already-`LOCKED` report. A missing report
returns `404` (see "404 bug fix" below).

### RBAC (unchanged, already-approved grants)

`service_reports.lock` — already seeded, already granted only to
Admin/Owner and Manager (`prisma/seed.ts`), never Office Staff, never
Technician. No new permission was created for this step. Live-verified: an
Office Staff holder of `service_reports.confirm` (but not `lock`) and a
Technician both receive `403` against the real running server; a
`service_reports.lock` holder succeeds.

### API endpoint

Exactly one, per approved decision — no preview/eligibility endpoint:

- `POST /service-reports/:id/lock` — gated on `service_reports.lock`.

### Transaction / concurrency

One `$transaction`: pre-check existence (`404`) and status (`400`), then a
guarded `updateMany({ where: { id, status: CONFIRMED }, data: { status:
LOCKED, lockedBy, lockedAt } })` — `count === 1` or `ConflictException`
(`409`) — then the audit write, inside the same transaction. Same idiom as
Confirm (Step 6) and as `quotations.service.ts`/`work-orders.service.ts`.
Safe even with no data payload to protect (unlike Confirm, there are no
canonical rows being created — the guarded status update alone is the
entire operation, so no secondary defense-in-depth check was needed the
way Confirm's duplicate-canonical-data check was).

**Live-verified against the real dev server** (not only the test suite):
a sequential second lock attempt on an already-`LOCKED` report returned
`400`; two genuinely concurrent `POST /lock` requests against a still-
`CONFIRMED` report resolved to exactly one `201` and one `409`, with
exactly one `lockedBy`/`lockedAt` write, one canonical equipment-unit row
(never duplicated), and one audit entry surviving.

### `lockedBy` / `lockedAt`

Set exactly once, on the successful transition — same discipline as
`confirmedBy`/`confirmedAt` (Step 6) and `verifiedBy`/`verifiedAt` (Step
5). Never touched again by anything. No schema change — both columns
already existed, anticipated since Step 1.

### Audit

One `service_report_locked` entry per successful Lock, written inside the
same transaction (using `AuditService.write()`'s optional transactional-
client parameter, added in Step 6). Per approved decision, carries actor,
timestamp, `beforeData: { status: "CONFIRMED" }`, `afterData: { status:
"LOCKED" }` only — no reason/note field, matching the approved
confirmation-dialog-only design.

### Irreversibility

**Lock is forward-only.** There is no unlock operation, endpoint, method,
or UI anywhere in this codebase, and none should ever be added under
normal application operation. This mirrors Step 6's own approved Decision
6 (Confirm is forward-only) applied one stage further.

### Canonical and staging-data immutability during Lock

Lock touches only the `ServiceReport` row's `status`/`lockedBy`/`lockedAt`
columns. **Verified, not assumed**: a dedicated unit test asserts `lock()`
never calls `create`/`update`/`createMany` on any of the six canonical
detail-table delegates; the live validation confirmed a canonical equipment
unit row and a staging measurement row were byte-for-byte identical before
and after Lock. Confirm (Step 6) remains the only code path that has ever
written to canonical tables, and it only ever does so once, from `VERIFIED`
— Lock does not change that invariant.

### Accepted limitation — no amendment/correction mechanism (by design)

No mechanism exists anywhere in this codebase to correct a `LOCKED` (or
even a `CONFIRMED`) report's canonical data — Confirm only ever `create`s,
never `update`s or `delete`s. This is an **explicitly accepted gap**, not
an oversight: a future exceptional-correction capability must be a
separately designed feature that preserves full historical auditability
(e.g. an append-only correction record referencing the original row),
**never** an in-place mutation of a locked (or confirmed) canonical row.
**Do not introduce an Unlock operation to work around this.**

### Queue discoverability for CONFIRMED reports

The Service Report queue (`/service-reports`) now requests
`PENDING_VERIFICATION,VERIFIED,CONFIRMED` (extended from Step 6's own
`PENDING_VERIFICATION,VERIFIED`), since a `service_reports.lock` holder
otherwise had no way to find a `CONFIRMED` report through the UI at all —
the same discoverability gap Step 6 already fixed once for `VERIFIED`
reports, recurring one stage later. A `CONFIRMED` row's action link reads
"Lock →" and routes directly to the canonical viewer (`/canonical`),
where the Lock action itself lives, rather than through the verify page.
**Approved as part of Step 7.**

### Canonical viewer

No changes were needed to `getCanonicalView` — it already treated
`CONFIRMED` and `LOCKED` identically for read access, built that way in
Step 6 before Lock existed. The UI's Lock button is shown only when the
caller holds `service_reports.lock` **and** the report's status is exactly
`CONFIRMED`; it is absent for every other status, including `LOCKED`
itself.

### 404 bug fix (found while implementing this step)

`ConfirmationPlanBuilderService.buildPlan()` threw a plain `Error` for a
missing report — caught by the global exception filter as a `500`, not a
`404`. Found while reusing this same pre-check pattern for `lock()`.
Fixed to throw `NotFoundException`, matching the convention already used
everywhere else in this codebase (e.g. `findReportOrThrow`). No test
depended on the prior behavior; nothing else in Step 6's approved design
was touched.

## Test baseline (frozen reference point — Phase 5 final totals)

| Suite | Result |
|---|---|
| Backend unit | 334/334 passing (328 baseline + 6 new) |
| Backend E2E | 203/203 passing (194 baseline + 9 new) |
| Frontend (Vitest) | 57/57 passing (49 baseline + 8 new) |
| Backend/frontend typecheck | clean |
| Backend/frontend lint | clean (2 pre-existing warnings in an untouched Step-4-era e2e file) |

Coverage specifically includes: transition only from `CONFIRMED` (rejecting
every other status including already-`LOCKED`); `lockedBy`/`lockedAt`
correctness; the audit entry's exact shape; zero canonical-table writes;
RBAC for all four roles; sequential and genuinely-concurrent double-lock
protection; canonical-viewer accessibility after Lock; queue listing.

### Live end-to-end validation (real dev server, real Postgres, real browser)

- **Manager Lock** — full browser walkthrough: queue → canonical viewer →
  "Lock Report" → confirmation dialog ("This is permanent... cannot be
  undone") → "Locking…" → **Locked** badge, button correctly gone, all
  canonical data still fully visible read-only.
- **Office Staff (holds `confirm`, not `lock`) → `403`**; **Technician →
  `403`** — both against the live server.
- **Sequential double-lock** on an already-locked report → `400`, status
  remained `LOCKED`.
- **Genuine concurrent double-lock** (two simultaneous requests against the
  live server) → exactly one `201`, one `409`.
- **Database cross-checks**: `lockedBy`/`lockedAt` correctly set;
  `confirmedBy`/`confirmedAt` from Step 6 untouched; exactly one
  `service_report_locked` audit row per report with the correct actor and
  before/after status; canonical equipment-unit row and staging
  measurement row byte-for-byte identical before and after Lock, never
  duplicated by the concurrent race.

## Change control

No further changes to the `CONFIRMED → LOCKED` transition rule, the RBAC
grants, the transaction/idempotency mechanism, or the queue-discoverability
behavior above without explicit approval. **No Unlock operation is to be
introduced under normal application operation.** The frozen Step 1–6
architecture (`phase5-extraction-reliability-baseline.md`,
`phase5-step5-verification-baseline.md`, `phase5-step6-confirm-baseline.md`)
was not modified by this work, apart from the one disclosed 404 bug fix
inside Step 6's `ConfirmationPlanBuilderService`.

---

## Phase 5 — Service Report Intake — COMPLETE / FROZEN

With Step 7 approved, every step of the Phase 5 pipeline defined in
`rev7-blueprint-summary.md` is now built, tested, and frozen:

| Step | Scope | Status |
|---|---|---|
| 1–4 | OCR/AI Extraction, Extraction Staging | FROZEN — `phase5-extraction-reliability-baseline.md` |
| 5 | Human Verification | FROZEN — `phase5-step5-verification-baseline.md` |
| 6 | Confirm Report / Canonical Write | FROZEN — `phase5-step6-confirm-baseline.md` |
| 7 | Lock | FROZEN — this document |

No further Service Report Intake steps remain. The next top-level phase
per the approved roadmap (`rev7-blueprint-summary.md`, "Development
phases") is **Phase 6 — Dashboard**.
