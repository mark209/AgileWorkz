# Phase 5 Step 6 — Confirm Report / Canonical Service Report Write

**Status: APPROVED / FROZEN.** No further changes to the canonical write
rules, the taxonomy fallback behavior, the transaction/idempotency
mechanism, the RBAC grants, or the queue-listing deviation below without
explicit approval. This document is the durable record — the working
history lived only in conversation until now.

## Scope

Covers the "Confirm Report" stage of the Phase 5 pipeline defined in
`rev7-blueprint-summary.md`:

```
Original Document → OCR/AI Extraction → Extraction Staging
  → Human Verification → Confirm Report [frozen here]
  → Canonical Service Report Data → LOCKED
```

Upstream stages are covered by `phase5-extraction-reliability-baseline.md`
(Steps 1–4) and `phase5-step5-verification-baseline.md` (Step 5), neither
of which was modified by this work. Downstream — the final administrative
Lock (`CONFIRMED → LOCKED`) — is now built and frozen too; see
`phase5-step7-lock-baseline.md`.

## Objective

Take a report in `VERIFIED` status and write the reviewer-approved staging
data into the canonical `service_report_*` tables exactly once, moving the
report to `CONFIRMED`. This is **the only code path permitted to write to
canonical tables**, mirroring the "one writer" discipline already
established for `ocr_worker` (staging tables, `ocr-worker-db-isolation.md`)
and for verification's review columns (Step 5).

## Approved architecture (frozen)

### Canonical write, by category

| Staging | Canonical | Rule |
|---|---|---|
| `extraction_basic_info` | `ServiceReport` header + `ServiceReportTechnician` | Recognized field names map to `serviceDate`/`timeIn`/`timeOut`/`reportReferenceNumber`/`contactName`/`contactPhone`; a repeating `fieldName` becomes one technician row per occurrence; **any unrecognized field name is never dropped** — folded into `generalNotes`, labeled with its own field name |
| `extraction_equipment_units` | `ServiceReportEquipmentUnit` | One canonical row per `rowIndex` group; `equipmentTypeCode` resolves by exact (never fuzzy) match against the seeded taxonomy, else `OTHER`; any unrecognized field's raw text is folded into `description` so free-text type wording is never lost even under the `OTHER` fallback |
| `extraction_problems` | `ServiceReportProblem` | Checkbox-aware: an `"unchecked"` literal is skipped (no record); `"checked"` uses the checkbox's own printed label as `description`; `problemTypeCode` resolves by exact match, else stays `null` (already nullable — no fallback code needed) |
| `extraction_measurements` | `ServiceReportMeasurement` | `measurementTypeCode` trusts the pipeline's own `suggestedMeasurementTypeCode` as-is (re-validated for continued taxonomy membership, never re-derived from field-name text); falls back to `OTHER_UNMAPPED` when absent or no longer valid; `sourceFieldName` always recorded (see Provenance below) |
| `extraction_narrative_items` | `ServiceReportNarrativeItem` | `category` resolves only against the fixed enum-like set (`WORK_DESCRIPTION`/`FINDING`/`RECOMMENDATION`/`REMARK`/`CUSTOMER_REMARKS`), else `null` — `description` always carries the full text regardless |
| `extraction_signoffs` | `ServiceReportSignoff` | `signoffRoleCode` resolves via a small fixed field-name lookup table, else `OTHER`; `signatoryName`/`signed` derived from whether the value is a checkbox-style literal or an actual name |

**Equipment association**: equipment-unit canonical rows are created first;
dependent categories (measurement/problem/narrative) resolve
`equipmentUnitId` by matching their staging `rowIndex` against the
just-created equipment units, in-memory, within the same transaction.

**No fuzzy/speculative matching anywhere** (approved Decisions 1–3): every
resolution is either a value the pipeline already deterministically
produced, or an exact, case/whitespace-normalized match against a real
seeded taxonomy row or a small fixed lookup table. A miss always falls back
to the approved code — never blocks Confirm, never guesses.

### `CONFIRMED_BLANK` / empty-record prevention (Decision 4)

A repeating-group canonical row (equipment unit) is created **only when at
least one field in its group is non-blank** — an entirely blank group is
skipped outright. A single-row category (problem/measurement/narrative/
signoff) with a blank verified value is skipped the same way. Dedicated
tests (`confirmation-plan-builder.service.spec.ts`,
`service-report-confirmation.e2e-spec.ts`) assert no empty
equipment/problem/measurement/narrative/signoff record is ever created.

### Measurement taxonomy fallback — `OTHER_UNMAPPED` (Decision 1)

`measurement_types` gained one seeded row, **`OTHER_UNMAPPED`** (never
suggested by the extraction pipeline itself — absent from its approved-code
prompt context, so the model can never emit it; it exists solely as
Confirm's own last-resort target). `service_report_measurements
.measurement_type_code` remains `NOT NULL`; it is never made nullable, and
a legitimate verified measurement lacking a taxonomy mapping never blocks
Confirm.

### Provenance (`source_field_name`)

`service_report_measurements` gained one new nullable column,
**`source_field_name`** (migration
`20260830090000_phase5_step6_confirm_measurement_provenance`), a
denormalized copy of the originating `extraction_measurements.field_name`.
Needed because `sourceRowIndex` alone is ambiguous — several distinct
readings can legitimately share one equipment-unit `rowIndex` — so without
this column, a value that fell back to `OTHER_UNMAPPED` would have no way
to show what it actually was. Written for every measurement, not only
unmapped ones. Equipment/problem/narrative/signoff needed no equivalent new
column: their own free-text columns (`description`, `signatoryName`)
already carry the original wording even under an `OTHER` fallback, and the
`sourceRowIndex` column already present on every canonical detail table
provides sufficient traceability given each staging category's own shape.

A full manifest — every canonical row created, paired with its originating
staging row id/field name — is additionally written into the Confirm audit
record itself (see Audit below), providing complete reconstruction even
for the categories without a dedicated provenance column.

### Reversibility (Decision 6)

Confirmation is **forward-only**. There is no "un-confirm" operation, and
none was built. The approved lifecycle remains `CONFIRMED → correction(s) →
LOCKED`; Step 6 implements no forward-correction workflow itself (not
required for this step) and no canonical row is ever deleted by Confirm or
by anything built in this step.

### Confirm Preview (Decision 7)

`GET /service-reports/:id/confirm/preview` runs the exact same
`ConfirmationPlanBuilderService` logic Confirm itself runs, against the
live (non-transactional) database connection — zero persistent writes. It
surfaces planned canonical records, skipped all-blank groups,
`OTHER_UNMAPPED` measurements, `OTHER` equipment/signoff classifications,
resolved taxonomy/stage mappings, equipment associations, and warnings.
**The preview payload is never trusted as input to Confirm** — `POST
.../confirm` independently re-reads and re-validates all staging data from
scratch inside its own transaction.

### Transaction / idempotency (approved 8-step order)

`POST /service-reports/:id/confirm` runs as one Prisma `$transaction`:
re-read/validate → defensively reject `NEEDS_FOLLOW_UP`/unreviewed/invalid
state → resolve mappings → create equipment units (building the `rowIndex
→ canonical id` map) → create dependent rows → guarded status update
(`updateMany({where:{id,status:VERIFIED}})`, same idiom already used by
`quotations.service.ts`/`work-orders.service.ts`) → audit write, inside the
same transaction. A failure anywhere rolls back everything.

The status guard runs **last**, per your explicit ordering, and this is
still safe: two concurrent transactions' `UPDATE`s against the same row are
serialized by Postgres row-level locking — the loser's `WHERE status =
VERIFIED` no longer matches once the winner has committed, so it throws
`ConflictException`, and because everything is inside one transaction, that
failure rolls back every canonical row the loser had created earlier in the
same call. An additional defense-in-depth check refuses Confirm outright if
canonical data already exists for the report under any circumstance.
**Verified against the real dev server**, not only the test suite: two
genuinely concurrent `POST /confirm` requests fired at the live API
resolved to exactly one `201` and one `409`, with exactly one set of
canonical rows persisted.

### Audit

One `service_report_confirmed` audit entry per Confirm, written inside the
same transaction (`AuditService.write()` gained an optional transactional-
client parameter for this — backward-compatible, every prior call site
unaffected). Carries before/after status, created-row counts per category,
the skipped-groups list, the warnings list, and the full
canonical-id ↔ staging-row-id manifest described under Provenance above.

### RBAC

No new permissions were created. `service_reports.confirm` already existed
in the seeded Phase 5 permission set, already granted to Admin/Owner,
Manager, and Office Staff, already withheld from Technician
(`prisma/seed.ts`). Confirm/Preview require `service_reports.confirm`; the
canonical viewer requires the broader `service_reports.read` instead — the
same permission the queue list already used — since inspecting confirmed
data needs no confirm authority.

### Staging retention (Decision 5)

Unchanged: staging rows are retained permanently, read-only, after Confirm.
Nothing in this step deletes or mutates a staging row.

## UI (Decision 8 — minimal canonical viewer)

- The existing verify page (`/service-reports/[id]/verify`) now shows a
  **Confirm Report** panel (preview + confirm action) when the report is
  `VERIFIED`, and a **"View canonical report →"** link when `CONFIRMED`/
  `LOCKED`, replacing the old generic read-only banner for those two
  statuses specifically.
- A new minimal, read-only **canonical viewer**
  (`/service-reports/[id]/canonical`) shows header/basic information,
  technicians, equipment units, problems, measurements, narratives, and
  signoffs — no equipment history, dashboards, or advanced reporting, per
  the approved scope boundary.

## Approved deviation: Service Reports queue now also lists VERIFIED

Discovered during live testing: a Confirm-capable user had no way to reach
a `VERIFIED` report through the UI at all — the queue
(`/service-reports`) only ever listed `PENDING_VERIFICATION`. The queue now
requests `PENDING_VERIFICATION,VERIFIED` (the backend's multi-status
listing already supported this since Step 5) and labels each row's action
link `Verify →` or `Confirm →` accordingly. **Approved as part of Step 6.**

## API changes

- `GET /service-reports/:id/confirm/preview` — read-only plan, `service_reports.confirm`
- `POST /service-reports/:id/confirm` — the atomic writer, `service_reports.confirm`
- `GET /service-reports/:id/canonical` — canonical viewer data, `service_reports.read`

## Schema/seed changes

- Migration `20260830090000_phase5_step6_confirm_measurement_provenance`:
  additive nullable `service_report_measurements.source_field_name`.
- Seed addition: `measurement_types` row `OTHER_UNMAPPED` (data-only, no migration).
- No other schema change — the full canonical table set was already built in Step 1.

## Test baseline (frozen reference point)

| Suite | Result |
|---|---|
| Backend unit | 328/328 passing (292 baseline + 36 new) |
| Backend E2E | 194/194 passing (184 baseline + 10 new) |
| Frontend (Vitest) | 49/49 passing (33 baseline + 16 new) |
| Backend/frontend typecheck | clean |
| Backend/frontend lint | clean (2 pre-existing warnings in an untouched Step-4-era e2e file) |

Coverage specifically includes: empty-record prevention across all five
detail categories; `OTHER_UNMAPPED`/`OTHER` fallback with provenance
preserved; equipment association by `rowIndex`; defensive rejection of
`NEEDS_FOLLOW_UP`/unreviewed state even against directly-seeded
inconsistent data; sequential and real-transaction concurrent double-confirm.

### Live end-to-end validation (real dev server, real Postgres, real browser)

Walked the full `PENDING_VERIFICATION → VERIFIED → Confirm Preview →
CONFIRMED → canonical viewer` pipeline in the browser and cross-checked
every canonical row directly against the database:

- **CORRECTED** — Work Date AI value "August 28, 2026" vs. canonical
  `serviceDate` = `2026-08-27` (the corrected value)
- **CONFIRMED_BLANK** — Contact Person/Tel No. left `contactName` null
- **OTHER_UNMAPPED measurement** — "Compressor Amp Draw" (no suggested
  code) → `measurementTypeCode = OTHER_UNMAPPED`, `sourceFieldName`
  preserved and visible in the canonical viewer
- **Equipment association** — all 4 measurement rows linked to the same
  canonical equipment unit (`AC#1`) by `rowIndex`
- **Immutability** — original staging `aiValue`/`aiConfidence` for Breaker
  Capacity confirmed untouched after Confirm
- **Concurrent confirm** — two genuinely simultaneous `POST /confirm`
  requests against the live dev server resolved to one `201` / one `409`,
  with exactly one set of canonical rows persisted, no duplication

## Known limitations

- Taxonomy resolution (equipment type, measurement type, signoff role) is
  deterministic-exact-match-only by design (no fuzzy matching, per
  approved decision) — it falls back to `OTHER`/`OTHER_UNMAPPED` whenever
  the extraction pipeline's own field wording doesn't exactly match the
  seeded taxonomy. This is expected, not a defect.
- Basic-info date/time parsing (not covered by the approved decisions) is
  intentionally conservative: only clearly-formatted dates/times parse into
  `serviceDate`/`timeIn`/`timeOut`; anything else is preserved, labeled, in
  `generalNotes` rather than guessed.
- A narrow theoretical gap: two same-`fieldName` measurements sharing one
  equipment-unit group, both with an unresolvable raw `stage` string, could
  be hard to individually distinguish from the canonical rows alone —
  never data loss (the permanently-retained staging rows plus the audit
  manifest still resolve it), but not fully disambiguated by a dedicated
  column. Judged not worth a further schema addition given how complete
  the seeded stage taxonomy already is.
- In-memory authentication (pre-existing, documented in
  `phase5-step5-verification-baseline.md`) again meant live testing
  required client-side navigation rather than URL-bar entry — not a Step 6
  issue.

## What remains in Phase 5

Nothing — Step 7 (Lock, `CONFIRMED → LOCKED`) is now also built and frozen.
See `phase5-step7-lock-baseline.md`. Phase 5 — Service Report Intake is
complete.

## Change control

No further changes to the canonical write rules, the taxonomy fallback
behavior (`OTHER`/`OTHER_UNMAPPED`), the transaction/idempotency mechanism,
the RBAC grants, or the queue-listing deviation above without explicit
approval. The frozen Step 1–5 architecture
(`phase5-extraction-reliability-baseline.md`,
`phase5-step5-verification-baseline.md`) was not modified by this work.
