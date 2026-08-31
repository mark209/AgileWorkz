# Phase 7 — Hardening Plan (DRAFT — PENDING APPROVAL)

**Status: DRAFT.** Not implemented, not approved. This document is for
review only. Nothing in it has been built. Grounded entirely in direct
inspection of the current, frozen Phase 1–6 codebase (`apps/api`,
`apps/web`, `apps/field`, `prisma/`) — no generic checklist items were
added without a corresponding concrete finding in this repo.

## How to read this document

Each numbered section below corresponds to one of the 13 priorities you
gave, plus a section for concerns outside that list, the Phase 4
carry-forward debt classification, and a recommended sequence. Every
finding has an ID (e.g. `F1.1`) referenced again in the sequence at the
end. For each finding: **Risk**, **Severity**, **Component**, **Proposed
change**, **Schema/API/RBAC impact**, **Regression risk**, **Tests
required**, **Timing**. Findings marked **(confirmed strength)** are
things this codebase already does correctly — recorded so they aren't
mistaken for gaps, not action items.

---

## 1. Security and authorization hardening

### F1.1 — No server-side session/token revocation
- **Risk**: Deactivating/suspending a user, or a user logging out, does
  not invalidate their already-issued tokens. `logout()` only writes an
  audit entry (`auth.service.ts`'s own comment: *"stateless JWTs with no
  server-side refresh-token store... nothing to revoke server-side yet"*).
  `refresh()` re-checks `user.status === ACTIVE`, but the `JwtStrategy`
  used on every protected request does **not** check `user.status` at
  all — it only verifies the signature/expiry. A deactivated user's
  existing access token stays fully valid for up to 15 minutes, and their
  refresh token (if not additionally re-checked) for up to 7 days.
- **Severity**: MEDIUM-HIGH — field technician devices are the realistic
  loss/theft scenario this protects against.
- **Component**: `identity/jwt.strategy.ts`, `identity/auth.service.ts`.
- **Proposed change**: Add a per-user revocation check — either (a) a
  `User.sessionsInvalidatedAt` timestamp checked against the token's
  `iat` claim in `JwtStrategy.validate()`, bumped on deactivate/suspend/
  explicit logout-everywhere; or (b) a Redis-backed short-lived
  denylist. Recommend (a) — no new infrastructure dependency, small
  schema addition.
- **Schema/API/RBAC impact**: **Schema change** (one new nullable
  `DateTime` column on `User`). No RBAC change. `JwtStrategy.validate()`
  becomes async (one indexed lookup per request — cacheable).
- **Regression risk**: MEDIUM — touches every authenticated request path.
- **Tests required**: New unit tests for `JwtStrategy`; new e2e tests:
  deactivate-then-existing-token-rejected, logout-then-token-rejected.
- **Timing**: **BEFORE PRODUCTION.**

### F1.2 — No account lockout after repeated failed logins
- **Risk**: `POST /auth/login` is rate-limited (10/min) but never locks
  an account — rate limiting slows brute force, it doesn't stop it.
- **Severity**: LOW-MEDIUM.
- **Component**: `identity/auth.service.ts`.
- **Proposed change**: Track consecutive failures (a counter column or a
  short-TTL Redis key) and lock for a cooldown window after N failures.
- **Schema/API/RBAC impact**: Small schema addition or Redis-only (no
  schema change if Redis-based). `/auth/login` gains a `423`-style
  response path.
- **Regression risk**: LOW.
- **Tests required**: New unit + e2e for lockout/unlock behavior.
- **Timing**: BEFORE PRODUCTION.

### F1.3 — Health endpoint exposes raw error text to unauthenticated callers
- **Risk**: `GET /health` (`@Public()`) returns `error: (e as Error).message`
  for DB/queue/storage failures — a minor info-disclosure surface during
  an outage, to any caller with no authentication.
- **Severity**: LOW.
- **Component**: `health/health.controller.ts`.
- **Proposed change**: Return only booleans publicly; log full detail
  server-side only (matches the existing `AllExceptionsFilter` pattern).
- **Schema/API/RBAC impact**: Response shape narrows (check any monitoring
  tooling that parses `.error` text before changing this).
- **Regression risk**: LOW.
- **Tests required**: Update the health e2e test's assertions.
- **Timing**: BEFORE PRODUCTION.

### F1.4 — Rate limiter uses in-memory storage
- **Risk**: `ThrottlerModule.forRoot(...)` has no Redis-backed storage
  configured — correct for a single instance today, but if the API is
  ever horizontally scaled, each instance tracks its own counters,
  multiplying the effective limit by instance count.
- **Severity**: LOW today, MEDIUM if/when scaled.
- **Component**: `app.module.ts`.
- **Proposed change**: Switch to a Redis-backed `ThrottlerStorage` using
  the already-provisioned Redis instance.
- **Schema/API/RBAC impact**: None.
- **Regression risk**: LOW.
- **Tests required**: Existing throttle tests should still pass unchanged.
- **Timing**: POST-V1 (only matters once horizontal scaling is planned).

### F1.5 — No boot-time guard against an overly permissive CORS origin in production
- **Risk**: CORS is correctly restricted to exactly `[WEB_APP_ORIGIN,
  FIELD_APP_ORIGIN]` today (confirmed — no wildcard). There is, however,
  no safeguard if a production `.env` is ever misconfigured with an
  overly broad value.
- **Severity**: LOW (cheap insurance, not a live gap).
- **Component**: `config/env.validation.ts`.
- **Proposed change**: Add a Joi rule rejecting `*` or non-HTTPS origins
  when `NODE_ENV=production`.
- **Schema/API/RBAC impact**: None (boot-time only).
- **Regression risk**: LOW.
- **Tests required**: New env-validation unit test cases.
- **Timing**: BEFORE PRODUCTION.

### (confirmed strength) Helmet, CORS allowlist, global ValidationPipe, JWT secret-length enforcement
`helmet()` is applied; CORS is a strict two-origin allowlist; the global
`ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) is
correctly wired; `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` are
`Joi.string().min(16).required()` and fail boot if missing/short. No
action needed on any of these.

---

## 2. Input validation and API error handling

### F2.1 — Several list-endpoint query params bypass the global ValidationPipe
- **Risk**: `GET /audit-logs` (`take`/`skip` manually `Number(...)`'d, no
  min/max/NaN guard — a request like `?take=999999999` or `?skip=-1` is
  not rejected), and the `status` query param on `GET /quotations`, `GET
  /work-orders`, `GET /service-reports` (raw `string`, validated ad hoc
  inside the controller rather than via a DTO) all skip `ValidationPipe`'s
  whitelist/transform/bounds-checking because they use bare `@Query("x")`
  instead of a DTO class. `documents.controller.ts` already does this
  correctly with `ListDocumentsQueryDto` — an existing, provable pattern
  to extend.
- **Severity**: LOW-MEDIUM (an unbounded `take` on audit logs is a mild
  self-inflicted-DoS vector; the ad hoc status validation is functionally
  fine today but inconsistent and untyped).
- **Component**: `audit.controller.ts`, `quotations.controller.ts`,
  `work-orders.controller.ts`, `service-reports.controller.ts`.
- **Proposed change**: Add typed query DTOs (`@IsInt() @Min(1) @Max(200)`
  for `take`, similarly bounded `skip`; an enum-backed `status` list)
  matching `ListDocumentsQueryDto`'s existing precedent.
- **Schema/API/RBAC impact**: None to schema/RBAC. API: an out-of-range
  `take`/`skip` or invalid `status` value that previously silently
  passed through now returns `400` — a narrow behavioral tightening.
- **Regression risk**: LOW-MEDIUM — must confirm no legitimate existing
  caller relies on an out-of-range value.
- **Tests required**: New e2e cases for each endpoint's boundary/invalid
  values.
- **Timing**: BEFORE PRODUCTION.

### F2.2 — `S3_*` env vars aren't conditionally required when `STORAGE_PROVIDER=s3`
- **Risk**: `env.validation.ts` conditionally requires the Vertex AI vars
  when `EXTRACTION_PROVIDER=vertex-gemini`, but has no equivalent rule for
  `S3_ENDPOINT`/`S3_REGION`/`S3_BUCKET`/`S3_ACCESS_KEY_ID`/
  `S3_SECRET_ACCESS_KEY` when `STORAGE_PROVIDER=s3` — a deploy could boot
  successfully with `STORAGE_PROVIDER=s3` and missing S3 credentials,
  failing only at the first real upload.
- **Severity**: LOW-MEDIUM (deploy-time footgun, not a runtime security
  issue).
- **Component**: `config/env.validation.ts`.
- **Proposed change**: Add the same `.when('STORAGE_PROVIDER', { is:
  's3', then: Joi.required() })` pattern already used for Vertex, to the
  five S3 variables.
- **Schema/API/RBAC impact**: None.
- **Regression risk**: LOW.
- **Tests required**: New env-validation unit test cases.
- **Timing**: **BEFORE PRODUCTION** (must be caught before any prod
  deploy actually uses S3).

### (confirmed strength) Global error handling
`AllExceptionsFilter` already correctly distinguishes expected
`HttpException`s (message passed through — safe, deliberate) from
unexpected raw `Error`s (generic `"Internal server error"` to the client;
full message + stack logged server-side only). No `NODE_ENV` branch
exists or is needed — verbosity is already minimal in both environments.
No DTO-less `@Body()` parameter was found anywhere. No action needed.

---

## 3. Database integrity, transaction safety, concurrency

### F3.1 — Several status-driven transitions use a plain `update` instead of the established guarded-`updateMany` pattern
- **Risk**: This codebase has a strong, consistent, already-tested
  pattern for race-safe transitions: `updateMany({ where: { id, status:
  <required-source-status> }, data: {...} })`, checking `count === 0` to
  detect a lost race and throw `ConflictException`. It's used correctly
  for every genuinely high-stakes transition (Work Order
  schedule/start/complete/close/cancel, Assignment unassign, every
  Quotation revision lifecycle transition, Service Report confirm/lock).
  A smaller set of transitions instead use a plain `update()` after a
  separate read-and-assert check — a classic TOCTOU (time-of-check-to-
  time-of-use) gap where a concurrent request between the check and the
  write is not caught:
  - `work-orders.service.ts` — `requestCancel`, `dismissCancellationRequest`
  - `quotations.service.ts` — `createNextRevision`'s supersede-old-revision
    write
  - `service-report-verification.service.ts:384` — `completeVerification`
    (**`PENDING_VERIFICATION → VERIFIED`**, a core Phase 5 transition)
  - `service-report-verification.service.ts` — `submitFieldReview`,
    `bulkConfirmEligibleFields` (per-row updates keyed by row id, lower
    risk than a whole-report status transition)
- **Severity**: LOW for the Work Order/Quotation items (worst case:
  content edited on a just-transitioned row, or a request-cancel
  overwritten with a near-identical value — recoverable, not silent data
  loss). **MEDIUM for `completeVerification`** specifically, since it's a
  Phase 5 canonical-lifecycle transition and two concurrent verifiers
  racing to complete the same report's verification is a more plausible
  real scenario (multiple Office Staff working the same verification
  queue) than the others.
- **Component**: as listed above.
- **Proposed change**: Convert each to the same guarded-`updateMany`
  pattern already used everywhere else, for consistency and correctness.
- **Schema/API/RBAC impact**: None to schema/RBAC/API contract — same
  request/response shape, just an added edge-case `409` on a genuine
  race. **The `service-report-verification.service.ts` change touches
  frozen Phase 5 lifecycle code and requires your explicit approval
  before being scheduled, per your standing instruction** — flagged
  here, not silently queued.
- **Regression risk**: LOW — mechanical change matching an established,
  well-tested pattern; the Work Order/Quotation items are Phase 4 code
  (already yours to approve changes to going forward) and lower-stakes.
- **Tests required**: New concurrency e2e tests per endpoint, mirroring
  the existing "only one of two concurrent submit requests... succeeds"
  test already in `quotation-lifecycle.e2e-spec.ts`.
- **Timing**: `completeVerification` — BEFORE PRODUCTION, pending your
  explicit approval to touch Phase 5 code. The Work Order/Quotation items
  — POST-V1 (low real-world likelihood, not worth pilot/production-
  blocking effort).

### (confirmed strength) The dominant pattern is correct and tested
Every business-critical, hard-to-reverse transition already uses the
race-safe pattern and is covered by dedicated concurrency e2e tests. This
is the majority case, not the exception — F3.1 is a narrow, specific
finding against a broader correct baseline.

---

## 4. File upload and Service Report security

### F4.1 — No magic-byte/content verification of uploaded files
- **Risk**: Both `documents.service.ts` and `service-reports.service.ts`
  validate only the client-supplied `file.mimetype` (the browser's
  `Content-Type` header) against the allowlist — no verification that the
  file's actual bytes match the claimed type. A relabeled file with a
  spoofed `Content-Type` of e.g. `application/pdf` passes unchecked.
- **Severity**: MEDIUM — meaningfully mitigated already by the narrow
  allowlist (`pdf`/`jpeg`/`png`/`webp` only — no script-executing formats
  like `svg`/`html` are accepted at all), but still a real gap worth
  closing as defense-in-depth for a system that stores and later re-serves
  these files to other users.
- **Component**: `service-reports.service.ts`, `documents.service.ts`.
- **Proposed change**: Verify the buffer's actual file signature (e.g.
  via the `file-type` package) against the claimed MIME type before
  accepting; reject on mismatch.
- **Schema/API/RBAC impact**: None to schema/RBAC. **API behavior
  change**: a previously-accepted-but-mislabeled file is now rejected
  (`415`) — needs explicit approval since it changes upload-acceptance
  behavior for an edge case.
- **Regression risk**: LOW-MEDIUM — must verify all 4 real allowed
  formats' actual signatures don't trip false positives (e.g. some PDF
  producers' headers, some JPEG variants).
- **Tests required**: New unit tests per allowed format (real bytes) plus
  a deliberately-mislabeled-file rejection test.
- **Timing**: BEFORE PRODUCTION.

### F4.2 — No `Content-Disposition` control on served files
- **Risk**: No explicit `Content-Disposition: attachment` (or equivalent)
  is set when files are served back — content-type served is whatever was
  stored (client-supplied). Low practical exposure today given the narrow
  allowlist excludes script-executing formats, but worth closing alongside
  F4.1 as defense-in-depth.
- **Severity**: LOW.
- **Component**: `local-disk-storage.provider.ts`, S3 signed-URL
  generation path.
- **Proposed change**: Force `attachment` disposition (or confirm
  `X-Content-Type-Options: nosniff` from `helmet()` already covers the
  practical risk — verify before adding redundant work).
- **Schema/API/RBAC impact**: None.
- **Regression risk**: LOW.
- **Tests required**: Update file-serving tests to assert the header.
- **Timing**: POST-V1.

### F4.3 — No malware/virus scanning on uploaded documents
- **Risk**: Files from field technicians' personal/shared devices (and
  customer-facing document uploads) are stored and later served to other
  staff with no scanning step.
- **Severity**: MEDIUM for a production system accepting files from
  devices outside IT's control.
- **Component**: `service-reports.service.ts`, `documents.service.ts`,
  storage layer.
- **Proposed change**: Integrate a scanning step (e.g. a ClamAV sidecar
  or a cloud AV API) before a file is ever served back to a second user.
  This is a genuinely new capability, not a tweak — needs its own design
  approval (sync-blocking-upload vs. async-with-a-`scanStatus`-column).
- **Schema/API/RBAC impact**: Likely a new `scanStatus` column if async;
  possible interim "scanning" state surfaced in the upload response.
  **Explicit design approval required before any implementation.**
- **Regression risk**: MEDIUM (touches the upload critical path).
- **Tests required**: New integration tests against the chosen scanner.
- **Timing**: BEFORE PRODUCTION given customer document handling, but
  the largest single lift in this section — recommend scoping it as its
  own mini-decision early in Phase 7 rather than late.

### (confirmed strength) Upload limits, storage-key generation, path-traversal protection, orphan cleanup
`MAX_UPLOAD_BYTES` (25MB) is enforced at the Multer stream level, not
just post-hoc. Storage keys use `crypto.randomUUID()` plus only the
*extension* of the original filename (never the base name) — no
path-traversal exposure from a malicious filename. `local-disk-storage
.provider.ts`'s `resolveSafe()` independently re-verifies every resolved
path stays under the storage root. A DB-write failure after a successful
storage write triggers `deleteObject` cleanup — no orphaned objects. No
action needed on any of this.

---

## 5. OCR/AI extraction failure handling, retries, timeout, human-verification safeguards

### F5.1 — No explicit timeout on the OCR provider HTTP call itself
- **Risk**: The queue already has a solid retry policy (3 attempts,
  exponential backoff from 5s) with correct terminal-vs-transient
  classification. But nothing wraps the actual provider call
  (`adaptiveExtraction.extract(...)` / `vertex-gemini.provider.ts`) with
  an application-level timeout — a hung external call would hold a
  worker for however long the underlying HTTP client's own default
  allows, and BullMQ's retry only engages once the call actually rejects,
  not while it's hanging.
- **Severity**: MEDIUM (availability risk under a degraded upstream OCR
  provider, not a correctness/data-integrity risk).
- **Component**: `vertex-gemini.provider.ts` / `adaptive-extraction.service.ts`.
- **Proposed change**: Wrap the provider call with an explicit timeout
  (e.g. 60–120s) that rejects and lets the existing retry/backoff take
  over.
- **Schema/API/RBAC impact**: None (internal-only change).
- **Regression risk**: LOW — purely additive; existing retry/failure
  classification logic is untouched.
- **Tests required**: New unit test simulating a hung provider call and
  confirming timely rejection + retry engagement.
- **Timing**: BEFORE PRODUCTION (real-provider-dependent risk — the
  stub provider used for internal pilot can't hang this way).

### F5.2 — No proactive alert when a report exhausts all retries
- **Risk**: `EXTRACTION_FAILED` is a correct, visible terminal status —
  the row and original document persist, nothing is silently dropped —
  but nothing proactively notifies staff. Discovery depends on someone
  noticing it in the verification queue.
- **Severity**: LOW-MEDIUM (a visibility gap, not a data-loss risk).
- **Component**: `service-report-extraction.processor.ts`, notification
  layer (doesn't exist yet).
- **Proposed change**: An audit-log-driven digest or a notification hook
  on `EXTRACTION_FAILED`. **Flagging as borderline "new feature" rather
  than pure hardening** — recommend you decide whether this belongs in
  Phase 7 or a later phase before it's scheduled.
- **Schema/API/RBAC impact**: None to schema/RBAC unless a notification
  channel needs its own config.
- **Regression risk**: LOW.
- **Tests required**: New tests for whichever mechanism is chosen.
- **Timing**: POST-V1, pending your scope decision.

### (confirmed strength) Retry/backoff, terminal-state handling, and the human-verification lifecycle
BullMQ's 3-attempt exponential-backoff policy and the processor's
last-attempt classification are already correct and tested. A report
that exhausts retries is marked `EXTRACTION_FAILED`, never left
ambiguously pending, never silently dropped. Re-confirmed during the
Phase 4 closure audit that Work-Order-linked uploads route through this
exact same pipeline with no bypass — this remains true and unaffected by
anything proposed here. No action needed on the pipeline's core shape.

---

## 6. Mobile/field-app reliability under slow or interrupted connections

### F6.1 — No request timeout in `apps/field`'s API client
- **Risk**: `apiRequest`/`apiUpload` in `apps/field/src/lib/api-client.ts`
  make a single `fetch()` call with no timeout and no retry. On a slow or
  interrupted cellular connection, a request can hang indefinitely with
  no feedback to the technician beyond an eventual browser-level network
  error.
- **Severity**: MEDIUM — this is precisely the target usage environment.
  *(Correction to an earlier assumption: the upload form's `catch` block
  does **not** clear the selected file on failure — `setFile(null)` only
  runs on success — so a retry after a failed upload does correctly
  re-send the already-selected file without requiring the technician to
  re-pick it from disk. The real gap is the absence of a timeout, not a
  lost file selection.)*
- **Component**: `apps/field/src/lib/api-client.ts`.
- **Proposed change**: Add an explicit client-side timeout (e.g. 30s)
  with a clear "request timed out — tap to retry" state, distinct from a
  hard failure.
- **Schema/API/RBAC impact**: None.
- **Regression risk**: LOW.
- **Tests required**: New component test simulating a slow/hanging fetch.
- **Timing**: BEFORE PILOT — cheap, directly serves the stated
  field-reliability goal.

### F6.2 — In-memory-only tokens mean a reload/backgrounding mid-task loses the session
- **Risk**: A page reload, or a mobile browser tab being killed by the OS
  under memory pressure (realistic on a technician's phone), silently
  logs the user out mid-task — including a filled-but-not-yet-submitted
  upload form. This is a **pre-existing, deliberate Phase 1 security
  tradeoff** (documented in code comments), not a defect.
- **Severity**: MEDIUM for `apps/field`'s realistic usage pattern, but
  changing the underlying security model (e.g. to a persisted refresh
  token or an httpOnly cookie) is out of scope for a hardening pass
  without your explicit sign-off.
- **Component**: `apps/field/src/lib/auth-context.tsx`.
- **Proposed change (scoped to NOT change the security model)**: persist
  only the non-file form field values (report type selection) to
  `sessionStorage` so a same-tab reload doesn't lose the whole form; the
  file itself cannot be persisted this way and would still need
  re-selection after a true reload. Optionally add a `beforeunload`/
  route-guard warning before navigating away from an unsaved form.
- **Schema/API/RBAC impact**: None — client-only, no change to the
  authentication model.
- **Regression risk**: LOW.
- **Tests required**: New component tests for the persistence/warning
  behavior.
- **Timing**: BEFORE PILOT for the scoped mitigation. **The deeper
  question of whether tokens should persist at all is an explicit
  decision for you, not something to change silently** — flagged, not
  scheduled.

### F6.3 — No offline/queued-submission support
- **Risk**: In a dead zone, every request simply fails — no local queue
  for later replay.
- **Severity**: Depends entirely on how often pilot technicians actually
  work in true dead zones (unknown without pilot data).
- **Component**: `apps/field` (would need a service worker / background
  sync / local queue — a substantial feature, not a hardening tweak).
- **Proposed change**: None proposed for Phase 7. Recommend explicitly
  deferring to POST-V1 and treating this as a scope decision, not a
  silent omission.
- **Schema/API/RBAC impact**: N/A (not being built).
- **Regression risk**: N/A.
- **Tests required**: N/A.
- **Timing**: POST-V1, pending real pilot-usage evidence that this is
  actually needed.

---

## 7. Duplicate submission/idempotency protection

### F7.1 — Service Report upload has no idempotency protection
- **Risk**: `POST /customers/:id/service-reports` unconditionally
  creates a new row with a freshly generated number and freshly stored
  file on every call — there is no DB-level uniqueness constraint or
  idempotency-key check. A double-tap, a client-side retry after an
  ambiguous/slow response, or a technician re-submitting because they
  didn't see confirmation (the exact slow/interrupted-connection scenario
  in §6) will create **duplicate Service Report rows for the same
  physical document**, each independently entering the OCR/verification
  queue and each requiring separate staff review.
- **Severity**: **HIGH** — explicitly named in your request, and a
  realistic, likely-to-occur scenario in the target field environment
  given F6.1's confirmed lack of a request timeout.
- **Component**: `service-reports.service.ts` (`upload()`),
  `UploadServiceReportDto`, `apps/field`'s `ServiceReportUploadForm`.
- **Proposed change**: Add a client-generated idempotency key (a UUID
  created once per form-open, sent as a field/header) checked server-side
  before creating a new row — a duplicate key returns the *original*
  response instead of creating a second row. This is the standard,
  correct fix; a time-window heuristic (reject a second upload from the
  same uploader/customer/site/work-order/report-type within N seconds) is
  a lighter but less precise alternative.
- **Schema/API/RBAC impact**: **Schema change required** — a small new
  table or column to record seen idempotency keys with a short TTL (or a
  Redis-backed key store, avoiding a schema change but adding an infra
  dependency for this one path). **API contract addition**:
  `UploadServiceReportDto` gains an optional `idempotencyKey` field
  (backward compatible for old callers, though they'd get no protection
  without sending one — the frontend should always send one going
  forward). No RBAC change.
- **Regression risk**: MEDIUM — the upload path is shared conceptually
  with `documents.service.ts`'s pattern; must be scoped narrowly to the
  Service Report upload entry point only, with zero touch to Phase 5
  extraction/verification/confirm/lock logic downstream of row creation.
- **Tests required**: New e2e test issuing two identical requests with
  the same key and asserting exactly one row is created; all existing
  upload tests must keep passing unmodified with no key supplied.
- **Timing**: **BEFORE PILOT.** This is the single highest-value,
  most concretely-justified item in this entire plan — recommend
  prioritizing it early despite being a schema/contract change, precisely
  because pilot technicians in real field conditions are the population
  most likely to trigger it. **Requires your explicit approval on the
  mechanism (idempotency key vs. time-window heuristic) before scheduling**,
  since it is a schema/contract change.

### F7.2 — `request-cancel` has no guard against a duplicate request
- **Risk**: `requestCancel` has no status-based guard (nothing gates it
  since it doesn't change `status`, only sets a nullable timestamp/reason)
  — two rapid clicks would both succeed, the second simply overwriting
  the reason/timestamp with a near-identical value.
- **Severity**: LOW — not a meaningfully harmful duplicate, just
  redundant writes.
- **Component**: `work-orders.service.ts`.
- **Proposed change**: Optionally guard with `where: {
  cancellationRequestedAt: null }` in an `updateMany`, for consistency
  with the rest of the codebase's pattern.
- **Schema/API/RBAC impact**: None.
- **Regression risk**: LOW.
- **Tests required**: One new e2e test if implemented.
- **Timing**: POST-V1 (cosmetic-severity).

### (confirmed strength) Every lifecycle PATCH endpoint is already idempotent-safe
Work Order schedule/start/complete/close/cancel, assignment
assign/unassign, and every Quotation revision transition are already
protected by the guarded-`updateMany` pattern — a duplicate/double-submit
request cleanly receives `409`/`400`, never a duplicate side effect.
**"Start Job" specifically needs no change** — it is already correctly
idempotent-safe today.

---

## 8. Logging, auditability, production-safe error reporting

### F8.1 — No per-request correlation/trace ID
- **Risk**: A production support engineer investigating "user X's action
  failed at 3:04pm" has no single ID to grep across log lines spanning
  the HTTP request, any queue job it triggered, and the eventual
  response.
- **Severity**: MEDIUM for production supportability (not a security
  issue).
- **Component**: `main.ts` (new middleware), `AllExceptionsFilter`,
  queue job logging.
- **Proposed change**: A lightweight request-ID middleware — generate/
  propagate an `X-Request-Id`, include it in every log line and in the
  error response body.
- **Schema/API/RBAC impact**: None to schema/RBAC. **API**: error
  response body gains one additional field (additive, non-breaking).
- **Regression risk**: LOW — review any existing e2e test asserting an
  exact response-body key set.
- **Tests required**: New middleware unit test; spot-check existing
  error-shape e2e assertions.
- **Timing**: BEFORE PRODUCTION.

### F8.2 — Logs go to stdout only, no shipping/retention
- **Risk**: No structured JSON logging, no shipping to a log aggregator.
  This is inherently an infrastructure/deployment decision, not an
  application-code change.
- **Severity**: MEDIUM for production operability.
- **Component**: Deployment/infra (cross-referenced under §11).
- **Proposed change**: Not an application-code item — recommend as a
  production-configuration deliverable, not Phase 7 code work.
- **Timing**: BEFORE PRODUCTION (infra work, tracked under §11).

### (confirmed strength) Error handling and audit coverage
`AllExceptionsFilter` never leaks internals (re-confirmed here). Spot-
checking every mutating method across Work Orders, Assignments,
Quotations (incl. sections/line-items/testing-items), Service Reports,
Documents, Customers, Contacts, Sites, and Inquiries found a
corresponding `AuditLog` write in every case — **no audit-log coverage
gap found**. No action needed.

---

## 9. Backup/recovery and data-retention readiness

### F9.1 — No backup automation for Postgres or object storage
- **Risk**: `infra/docker-compose.yml` is a pure local-dev setup
  (default `postgres`/`postgres` and `minioadmin`/`minioadmin`
  credentials, a single unbacked-up named volume each for Postgres and
  MinIO). There is no `pg_dump` cron, no volume snapshot policy, no S3
  versioning/replication configured anywhere.
- **Severity**: **HIGH** for production-readiness — a single disk
  failure or accidental `DROP`/delete with no tested restore path is
  total data loss, including every Service Report's original signed
  document.
- **Component**: Infrastructure (not application code).
- **Proposed change**: Managed Postgres with automated backups, S3
  bucket versioning + lifecycle policy, a documented and *tested* restore
  runbook (a drill, not just a written procedure).
- **Schema/API/RBAC impact**: None (infra-only).
- **Regression risk**: N/A.
- **Tests required**: A restore drill counts as the "test" here — restore
  from a backup into a scratch environment and verify integrity.
- **Timing**: **BEFORE PRODUCTION, non-negotiable.** Not required for an
  internal pilot using disposable/synthetic data, but real customer
  documents should not be stored until this exists.

### F9.2 — `document_retention_years` is stored but never enforced
- **Risk**: The `system_settings` key exists and is documented in the
  blueprint, but **no application code reads or acts on it anywhere** —
  confirmed via a repo-wide search. No scheduled job purges or archives
  anything. It is policy-only today.
- **Severity**: MEDIUM (a compliance/documentation-accuracy gap — the
  opposite failure mode of data loss, generally lower urgency than F9.1,
  but worth being honest that the setting currently does nothing).
- **Component**: `system-settings` module; no enforcement job exists.
- **Proposed change**: Either (a) build a scheduled retention-enforcement
  job — a genuinely new capability requiring explicit design (what
  "delete" means for a Service Report with a signed original document,
  soft- vs. hard-delete, interaction with audit-log immutability); or (b)
  explicitly document that retention is policy-only for V1 and defer
  enforcement. **Recommend (b)** given the scope of correctly designing
  (a) — flagging as a decision needed from you, not silently building or
  silently ignoring it.
- **Schema/API/RBAC impact**: None unless (a) is chosen, in which case
  schema/RBAC implications would need their own separate approval.
- **Regression risk**: N/A for (b).
- **Tests required**: N/A for (b).
- **Timing**: Decision needed now; enforcement itself (if approved) is
  POST-V1.

---

## 10. Performance review for realistic customer/site/equipment/work-order/service-report volumes

### F10.1 — Core list endpoints are unpaginated
- **Risk**: `GET /customers`, `GET /work-orders` (global and
  customer-scoped), `GET /quotations`, `GET /service-reports` all return
  every matching row with no `take`/`skip`/cursor (confirmed by direct
  code inspection — `GET /audit-logs` is the one exception, already
  correctly paginated with a default `take: 50`). Low risk at today's
  pilot volumes (dozens–low hundreds of rows); will degrade both API
  response time and `apps/web` list-page rendering as a real multi-month
  operating history accumulates.
- **Severity**: MEDIUM, timing-dependent on actual data growth.
- **Component**: `customers.service.ts`, `work-orders.service.ts`,
  `quotations.service.ts`, `service-reports.service.ts`, and their
  `apps/web` list-page consumers.
- **Proposed change**: Add `take`/`skip` pagination, with the current
  unpaginated behavior kept as a safe capped default (e.g. `take ?? 200`)
  rather than an abrupt breaking change.
- **Schema/API/RBAC impact**: None to schema/RBAC. **API**: response
  shape may need to move from a bare array to `{ data, total }` — this is
  a genuine contract change requiring approval; alternatively, add
  optional pagination params while keeping array responses and simply
  capping the default (lower-risk migration path, recommended).
- **Regression risk**: MEDIUM — every consumer of these four endpoints in
  both `apps/web` needs review.
- **Tests required**: New pagination-parameter e2e tests; existing list-
  page frontend tests must keep passing under whichever migration path is
  chosen.
- **Timing**: **BEFORE PRODUCTION** is prudent, but not urgent for an
  internal pilot at current volumes. Recommend monitoring actual row
  counts during pilot and treating sustained growth as the trigger to
  schedule this, rather than doing it preemptively without real data.

### F10.2 — No load/performance test exists anywhere
- **Risk**: No k6/artillery/autocannon tooling or script exists in the
  repo. Performance under realistic concurrent load has never been
  measured.
- **Severity**: MEDIUM — unknown risk, not a confirmed problem.
- **Component**: New tooling (not existing code).
- **Proposed change**: A lightweight load-test script exercising the
  Dashboard's aggregate queries and the enriched Work Order list under a
  realistic-volume seeded dataset, run manually before the production
  go-live decision.
- **Schema/API/RBAC impact**: None.
- **Regression risk**: N/A (new tooling, not a code change to the app).
- **Tests required**: The load test itself.
- **Timing**: BEFORE PRODUCTION.

### F10.3 — Prisma connection pool left at client defaults
- **Risk**: No tuning or documentation of pool size under concurrent
  load.
- **Severity**: LOW at pilot scale.
- **Component**: `prisma.service.ts` / `DATABASE_URL` connection params.
- **Proposed change**: Revisit only if F10.2's load test surfaces a real
  bottleneck — do not tune blindly without data.
- **Timing**: POST-V1 / data-driven.

---

## 11. Production configuration and secrets/environment validation

### F11.1 — No version control (no git repository at all)
- **Risk**: This project has never had `git init` run. There is no
  commit history independent of this conversation log, no code review
  mechanism, no rollback-by-revert, and (relatedly) the existing
  `.gitignore`'s `.env` exclusion has never actually been exercised.
- **Severity**: **HIGH** — this is arguably the single most foundational
  gap in the whole plan; CI (F12.1), code review, and safe rollback all
  depend on it existing first.
- **Component**: Project-wide (process, not application code).
- **Proposed change**: `git init`, an initial commit, and adoption of
  normal commit hygiene going forward. A process change, not something to
  do silently mid-review — flagged as a recommendation for your decision
  on timing, though it has no downside and no regression risk.
- **Schema/API/RBAC impact**: None.
- **Regression risk**: None.
- **Tests required**: N/A.
- **Timing**: Recommend **immediately**, independent of the rest of
  Phase 7 — every other process improvement (CI, code review) is blocked
  on this.

### F11.2 — No Dockerfile for any of the three apps
- **Risk**: There is no containerized, repeatable production build
  process for `apps/api`, `apps/web`, or `apps/field` — each can only be
  run via `pnpm ... dev`/`build`/`start` directly on a host.
- **Severity**: HIGH for production-readiness (blocks any standard
  container-based deployment).
- **Component**: Infrastructure (new `Dockerfile`s, not existing code).
- **Proposed change**: Author a `Dockerfile` per app plus a documented
  deploy runbook.
- **Schema/API/RBAC impact**: None.
- **Regression risk**: LOW (additive, doesn't touch existing dev
  workflow).
- **Tests required**: A successful containerized build + boot, smoke-
  tested against `/health`.
- **Timing**: BEFORE PRODUCTION.

### (cross-referenced, not duplicated) F2.2 (S3 env validation), F1.5 (CORS misconfiguration guard), F8.2 (log shipping)
All belong conceptually to this section too — see their full entries
above.

### (confirmed strength) Env validation, secrets hygiene
`env.validation.ts` already fails fast at boot on missing/short JWT
secrets, an invalid `DATABASE_URL`, invalid `STORAGE_PROVIDER`/
`EXTRACTION_PROVIDER` values, and correctly enforces the "never `global`"
Vertex AI region rule — a genuinely strong existing baseline, not a gap.
`.env` (with real secrets) exists at the repo root but `.gitignore`
already correctly excludes it, `.env.example` correctly holds only
placeholders, and no secret was found hardcoded in application source.

---

## 12. Automated regression, integration and E2E testing required before production pilot

### F12.1 — No CI pipeline exists
- **Risk**: No `.github/workflows` or equivalent — every test suite
  (334 backend unit, 224 backend e2e, 126 `apps/web`, 25 `apps/field`,
  all currently passing) runs only when a person manually invokes it.
  Nothing prevents a future change from silently regressing any of this.
- **Severity**: HIGH for regression safety over time, especially once
  more than one person is contributing.
- **Component**: New tooling (`.github/workflows/ci.yml` or equivalent).
- **Proposed change**: A CI workflow running backend unit + e2e (using
  the already-provisioned docker-compose services as CI service
  containers), `apps/web` and `apps/field` Vitest suites, typecheck, and
  lint on every push/PR.
- **Schema/API/RBAC impact**: None.
- **Regression risk**: None (this *is* the regression-prevention
  mechanism).
- **Tests required**: N/A (this adds test automation, doesn't need its
  own tests beyond confirming the pipeline itself runs green).
- **Timing**: **BEFORE PILOT** — depends on F11.1 (git) existing first;
  cheap relative to its ongoing value.

### (confirmed characteristic, not a defect) Quotations/Work Orders e2e-only test precedent
Both modules rely entirely on e2e tests with no dedicated unit-test
files — an established, intentional, already-documented precedent, and
the e2e coverage observed is strong (including explicit two-concurrent-
requests race tests). Not recommending a change to this precedent
without your input; noting it as a known tradeoff (e2e is slower to run
and harder to pinpoint failures in than unit tests) rather than a defect.

### F12.2 — No test exercises realistic concurrent multi-user load
- **Risk**: Beyond the deliberate two-request race tests for specific
  endpoints, nothing simulates multiple simultaneous technicians/staff
  under realistic load.
- **Severity**: Ties directly into F10.2's load-testing recommendation —
  not duplicated as a separate action item.
- **Timing**: Folded into F10.2, BEFORE PRODUCTION.

### Cross-cutting testing note
Every item above that proposes a code change (F1.1, F1.2, F2.1, F2.2,
F3.1, F4.1, F4.3, F5.1, F6.1, F6.2, F7.1, F7.2, F8.1, F10.1) has its own
"tests required" listed in its own entry — not restated here.

---

## Additional production-readiness concerns not in your original list

- **No monitoring/alerting/APM**: The `/health` endpoint (already
  solid — checks DB, queue, and storage) exists but nothing currently
  polls it. Recommend a simple uptime check hitting it, at minimum,
  before production. (BEFORE PRODUCTION)
- **No dependency-vulnerability scanning**: No `npm audit`/`pnpm audit`/
  Dependabot configured, despite a meaningful third-party surface (AWS
  SDK, Google GenAI SDK, Prisma, etc.). (BEFORE PRODUCTION, cheap to add
  once F11.1/F12.1 exist)
- **No incident-response/rollback runbook**: Ties to F11.2's deploy
  runbook — a bad deploy currently has no documented recovery procedure.
  (BEFORE PRODUCTION)
- **No accessibility (a11y) audit**: `apps/web` uses Radix primitives
  (generally accessible by default) but nothing has explicitly verified
  this (e.g. via `axe`). Low priority relative to everything else.
  (POST-V1)
- **Multi-branch/multi-company groundwork**: Explicitly out of V1 scope
  per the blueprint — confirming this was not overlooked, not
  recommending any action.

---

## Phase 4 carry-forward technical debt — classification

| Item | Classification | Rationale |
|---|---|---|
| 1. Pre-existing seed artifact (`QT-DEMO6-acc-ptdj` `ACCEPTED` with zero revisions) | **ACCEPTED RISK** | Cosmetic demo-data-only issue; doesn't affect any quotation created through the real lifecycle; "fixing" it means editing seed data for a debugging convenience, not a production concern. |
| 2. Minor test-coverage gap (`GET /service-reports/types` INACTIVE-exclusion not explicitly asserted) | **BEFORE PILOT** | Trivial to add (one new fixture + assertion), closes a real if small gap cheaply. |
| 3. Live-testing dialog-animation timing note | **ACCEPTED RISK** | A note for future manual QA sessions, not a product defect — nothing to fix in code. |
| 4. Test artifacts remaining in the dev database (Phase4 Field Technician user, WO-2026-08-01195, SR-2026-08-00087, QT-2026-08-02936) | **FIX NOW** (decision + action, before pilot data seeding) | Not a code defect, but should be explicitly resolved (deleted or deliberately kept) before the dev database is used as any kind of template or reference for pilot setup, so they're never mistaken for real data. Awaiting your decision — not deleted unilaterally per your standing instruction. |

---

## Recommended Phase 7 implementation sequence

**Wave 1 — before internal pilot** (cheap, high-value, low regression risk):
1. F11.1 — initialize git (unblocks everything else in this wave)
2. F12.1 — CI pipeline
3. **F7.1 — Service Report upload idempotency key** (highest-justified
   single item; needs your sign-off on mechanism first)
4. F6.1 — request timeout in `apps/field`'s API client
5. F6.2 (scoped mitigation) — form-state persistence / unload warning in
   `apps/field`
6. Phase 4 debt item 2 — INACTIVE-exclusion test
7. Phase 4 debt item 4 — your decision on the dev-DB test artifacts

**Wave 2 — before production** (real customer data, real deployment):
8. F1.1 — session/token revocation on deactivate + logout
9. F2.1 — typed query DTOs for list-endpoint params
10. F2.2 — S3 env validation
11. F4.1 — magic-byte file verification
12. F4.3 — malware scanning (design decision first, then implementation)
13. F5.1 — OCR provider call timeout
14. F8.1 — request-correlation IDs
15. F1.3 — health-endpoint error-detail scrubbing
16. F1.5 — CORS-misconfiguration boot guard
17. F9.1 — backup/restore runbook + a real restore drill (infra)
18. F11.2 — Dockerfiles + deploy runbook (infra)
19. F10.1 — pagination (schedule based on actual pilot data-volume trend)
20. F10.2 — load test pass
21. Additional-concerns: uptime monitoring, dependency scanning, rollback
    runbook

**Wave 3 — post-V1** (lower urgency / lower likelihood / larger scope):
22. F1.2 — account lockout
23. F1.4 — Redis-backed rate-limit storage
24. F3.1 (Work Order/Quotation portion) — remaining TOCTOU guards
25. F3.1 (`completeVerification`) — **pending your explicit approval to
    touch Phase 5 code**
26. F4.2 — Content-Disposition hardening
27. F5.2 — extraction-failure alerting (pending your scope decision)
28. F7.2 — request-cancel double-submit guard
29. F6.3 — offline/queued submission (pending real pilot-usage evidence)
30. F9.2 — retention enforcement (pending your decision; recommend defer)
31. Accessibility audit, dependency-scanning cadence

### Decisions needed from you before Wave 2 proceeds
- **F7.1**: idempotency-key vs. time-window heuristic (this is the one
  item I'd most want early sign-off on).
- **F1.1**: DB-timestamp check vs. Redis-backed revocation list.
- **F4.3**: malware-scanning scope/vendor, and whether it's a pilot or
  production requirement.
- **F9.2**: build retention enforcement now, or formally defer (I
  recommend defer).
- **F3.1 (`completeVerification`)**: explicit approval to modify this
  frozen Phase 5 transition, since nothing here proceeds without it.

---

Nothing in this document has been implemented. Waiting for your review,
scope decisions on the items flagged above, and approval before any
Phase 7 work begins.
