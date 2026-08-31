# Phase 5 — OCR/AI Extraction Reliability Baseline

**Status: FROZEN.** Approved with **CONDITIONAL PASS** for controlled pilot
use. No further OCR reliability, consensus, taxonomy, threshold, prompt, or
validation-rule changes are to be made to this architecture until the pilot
generates new evidence and a decision is made to revisit it. This document
is the durable record — the working history lived only in conversation
until now.

## Scope

Covers the "OCR/AI Extraction" and "Extraction Staging" stages of the Phase
5 pipeline defined in `rev7-blueprint-summary.md`:

```
Original Document → OCR/AI Extraction → Extraction Staging → [frozen here]
  → Human Verification → Confirm Report → Canonical Service Report Data → LOCKED
```

"Human Verification" is now built and frozen — see
`phase5-step5-verification-baseline.md`. "Confirm Report" is now built and
frozen too — see `phase5-step6-confirm-baseline.md`. The final
administrative Lock (`CONFIRMED → LOCKED`) is also now built and frozen —
see `phase5-step7-lock-baseline.md`. **Phase 5 — Service Report Intake is
complete.**

## Approved architecture (frozen)

- **Provider**: `VertexGeminiExtractionProvider` (`gemini-2.5-flash`,
  `asia-southeast1`), behind the vendor-neutral `ExtractionProvider`
  interface. ADC impersonation of `vertex-extraction-dev@agileworks-hvac-erp.iam.gserviceaccount.com`
  — no long-lived service-account keys.
- **Adaptive orchestration** (`AdaptiveExtractionService`): 1 extraction
  call by default; escalates to 2 more (in parallel) only when deterministic
  validation flags a concern. Hard cap of **3 calls maximum** per document —
  never to be raised without explicit approval.
- **Deterministic validation** (`extraction-validation.ts`,
  `extraction-field-rules.ts`): pre-escalation checks for critical HVAC
  fields (voltage, current, pressure, temperature, pipe size, breaker
  capacity, thermostat setting) — confidence, format, plausible-range,
  unexplained-abbreviation-taxonomy, and report-type-scoped checkbox
  coverage.
- **Reconciliation** (`extraction-consensus.ts`): cross-call field matching
  by taxonomy code first (safe against merging different measurements,
  since a code is only shared when the model itself asserts the same
  concept), word-normalized label matching as fallback, canonical
  before/after/during stage bucketing, checkbox fields always matched by
  label (never by code, since one loose code can legitimately cover several
  distinct checklist items). Majority/unanimous voting; never invents a
  value to reach consensus — genuine disagreement resolves to null +
  `requiresHumanVerification`.
- **Post-consensus risk assessment** (`extraction-risk-assessment.ts`,
  Stage C.1): re-applies format/range checks to the *final* reconciled
  value (catches shared misreads that survive voting); for critical fields,
  only *unanimous* is treated as sufficient — *majority* alone always
  requires human verification; flags when any contributing raw observation
  was itself low-confidence; cross-checks physically-related readings
  (high-side > low-side pressure; three-phase voltage balance within 20%).
  Never replaces a value — only ever adds a verification flag.
- **No schema change was needed anywhere in this work.** An unresolved
  field is expressed via the existing `ai_confidence = "unreadable"` value;
  observability detail (calls used, trigger reasons, token usage, cost,
  latency) lives in the existing `audit_logs.afterData` JSON.

Full correction history: Stage A found and fixed an indoor/outdoor
taxonomy bug; Stage B ran a 4-document, 3-run-each acceptance test and
found blank-field hallucination, an S/D taxonomy-abbreviation violation,
run-to-run transcription instability, and checkbox-extraction collapse;
Stage C implemented the adaptive/consensus architecture and fixed all four;
Stage C.1 hardened it further against systematic shared misreads (multiple
independent calls agreeing on the same wrong value) and improved semantic
field matching for free-text layouts.

## MR-template paired-reading finding — retracted as a system defect

During the production validation, 18 critical temperature fields on the
Maintenance Report template (documents MR0101, MR0153) were initially
reported as an unresolved open anomaly — two values appearing to share one
code and unit with no apparent explanation.

**Root cause: the diagnostic query used to investigate them omitted the
`stage` dimension.** A follow-up investigation, re-run with `stage` and the
full 3-call raw observations included, showed that the two values in every
case were the document's own **Before Cleaning** and **After Cleaning**
readings for the same physical unit — two genuinely different measurements,
correctly kept separate by the reconciliation layer's stage-bucketed field
identity. All 18 values were unanimous across all 3 Gemini calls (exact
digit-for-digit agreement) and internally consistent (discharge/supply
temperature below suction/return temperature in every unit, as physically
expected for an operating cooling system).

**Conclusion: no defect existed in extraction, field-identity matching,
taxonomy assignment, or reconciliation.** The extraction and reconciliation
pipeline correctly distinguished Before Cleaning and After Cleaning
measurements throughout. This finding does not factor into the Phase 5
approval decision.

## Production-validation baseline

Real, billed extraction of **21 genuine AgileWorks Solutions OPC reports**
(Service Reports + Maintenance Reports, spanning MAINTENANCE_CLEANING,
GENERAL_SERVICE_REPAIR, and INSTALLATION_COMMISSIONING) through the
unmodified pipeline above — no code changed during or after this run.

| Metric | Value |
|---|---|
| Documents tested | 21 |
| Resolved with 1 Gemini call | 6/21 (28.6%) |
| Escalated to 3 Gemini calls | 15/21 (71.4%) |
| Average calls per document | 2.43 |
| Total Gemini cost | $1.46757 |
| Average cost per document | ~$0.06988 |
| Confirmed confidently-incorrect critical HVAC values | **0** |
| Blank-field hallucination rate | **0%** |
| Checkbox spot-check accuracy | 28/28 (100%) |
| Overall human-verification rate | 65.3% |
| Critical-field human-verification rate | 84.8% |
| Overall unresolved-field rate | 35.8% |
| Critical unresolved-field rate | 17.8% |
| Taxonomy/unmapped measurement-field rate | 19.8% |
| Average extraction latency | ~62.1 seconds |
| MR paired-reading investigation | No system defect (see above) |

**Approval: CONDITIONAL PASS for controlled pilot use.** The zero-tolerance
safety metric (confidently-incorrect critical values) was met. The
architecture behaves as designed — conservative when evidence is weak,
never inventing values.

## Human verification remains mandatory — not a gap to be engineered away yet

The ~65-85% human-verification rate is **not a defect and not a blocker**.
Mandatory human verification of every extracted field before it can become
canonical data is Phase 5's own approved architecture (`ExtractionProvider`'s
own contract: "only a human verifier can confirm it into a real canonical
value"), independent of confidence level. Trigger-reason analysis on this
run showed ~86% of verification flags are evidence-based (the model's own
reported uncertainty, or a concrete format/range/contradiction failure) and
only ~14% are the deliberate conservative policy overlay (majority alone
insufficient for critical fields) — meaning most of the workload reflects
genuine source-document difficulty, not false caution.

**Reducing this rate is a future optimization target for after the pilot
generates real operating data — not a reason to keep modifying Phase 5
before pilot deployment begins.**

## Operational recommendation: service-report photo capture

Photo quality was the dominant driver of escalation and verification
workload in this validation. Recommended guidance for technicians
submitting service reports, to be adopted as an operational practice (no
code dependency):

- Capture the **full page** in one photo — nothing cropped or cut off.
- Lay the document **flat**, not held at an angle or curled.
- Ensure **adequate, even lighting** — avoid shadows across the form.
- Hold the camera **directly above** the report (minimize perspective
  skew), not from the side.
- **Avoid rotated/sideways photos** — several of the harder documents in
  this validation were shot in landscape orientation.
- **Verify image clarity before upload** — a quick zoom-in check that
  handwritten numbers are legible before submitting.

## Change control

No further changes to the OCR/AI extraction architecture, prompts,
consensus/reconciliation logic, validation rules, thresholds, or taxonomy
mapping without explicit approval. The 3-Gemini-call maximum is not to be
raised without explicit approval. Schema, RBAC, storage architecture, API
contract, and the `ExtractionProvider` interface remain unchanged from
their Phase 5 Step 1–4 baseline.
