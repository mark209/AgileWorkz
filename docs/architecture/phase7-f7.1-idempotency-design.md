# Phase 7 (F7.1) — Service Report Upload Idempotency: Mini-Design (PENDING APPROVAL)

**Status: DESIGN ONLY. No schema change has been made. No code has been
written against this design.** Per your instruction, this document exists
so you can review the exact schema/API behavior, migration, uniqueness
rule, retry behavior, and client-compatibility story before anything is
implemented.

## Problem recap

`POST /customers/:id/service-reports` (`ServiceReportsService.upload()`)
unconditionally creates a new `ServiceReport` row and stores a new file
object on every call. A double-tap, a client retry after a timeout (see
F6.1 — field-app requests now time out at 30s), or a technician
re-submitting because they saw no confirmation, creates two independent
Service Report rows for the same physical document.

## Proposed mechanism: client-generated idempotency key, server-enforced via a claim table

### Why a header, not a DTO field

Propose `Idempotency-Key: <uuid-v4>` as an HTTP request header, not a
field on `UploadServiceReportDto`. Reasons:
- It's a standard, well-known convention (Stripe, GitHub, and most major
  APIs use exactly this header name) — no bespoke shape to explain.
- It keeps the DTO focused on business fields only, matching this
  repo's existing convention (`UploadServiceReportDto`'s own comment:
  *"Only upload-time identifying fields are accepted here"*).
- It's naturally optional at the transport level — an absent header is a
  simple `if (!header)` check, not a DTO validation branch.

### Exact proposed schema addition

```prisma
// Phase 7 (F7.1) — proposed, not yet added.
model ServiceReportUploadIdempotencyKey {
  id             String   @id @default(uuid())
  idempotencyKey String   @map("idempotency_key") @db.VarChar(100)
  uploadedBy     String   @map("uploaded_by")
  status         IdempotencyKeyStatus @default(IN_PROGRESS)
  serviceReportId String? @unique @map("service_report_id")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  uploadedByUser User          @relation(fields: [uploadedBy], references: [id])
  serviceReport  ServiceReport? @relation(fields: [serviceReportId], references: [id])

  // The core uniqueness rule — see below.
  @@unique([uploadedBy, idempotencyKey])
  @@map("service_report_upload_idempotency_keys")
}

enum IdempotencyKeyStatus {
  IN_PROGRESS
  COMPLETED
  FAILED
}
```

One new table, one new enum. No change to `ServiceReport` itself beyond
an inverse (optional) relation field for the `@unique` FK above — no
existing column is touched, no existing index is touched.

### Uniqueness rule

`@@unique([uploadedBy, idempotencyKey])` — scoped **per uploader**, not
globally. Rationale: an idempotency key is only meaningful in the context
of who generated it (a UUID collision between two different technicians'
independently-generated keys is a coincidence, not a real duplicate;
scoping to the uploader avoids ever conflating two different people's
legitimately-identical-by-chance keys). This also means the key only
needs to be unique per-user, not globally unique across the whole table.

**No expiry/TTL and no cleanup job proposed.** Each successful upload
produces exactly one row in this table, so it grows at the same rate as
`ServiceReport` itself — a table this small (one row per real upload,
indefinitely) needs no purge logic at this application's scale, and
adding one would be exactly the kind of new "hardening surface" not
justified by the actual risk. If retention is ever revisited (see F9.2,
deferred), this table can be included in that future design rather than
getting its own bespoke policy now.

### Request flow / retry behavior

```
1. Client sends POST /customers/:id/service-reports
   with Idempotency-Key: <uuid> (multipart, same as today otherwise).

2. Server, inside the SAME transaction that will create the ServiceReport:
   a. If no Idempotency-Key header is present → today's exact behavior,
      unconditionally create a new row. Fully backward compatible.

   b. If a header IS present, attempt to INSERT a row into
      ServiceReportUploadIdempotencyKey (uploadedBy, idempotencyKey,
      status: IN_PROGRESS) BEFORE doing the storage write or the
      ServiceReport create.

      - INSERT succeeds → this request "owns" the key. Proceed with
        today's exact upload logic (storage write, then ServiceReport
        create in the transaction). On success, update this row to
        status: COMPLETED, serviceReportId: <new report's id>. On any
        failure partway through, update this row to status: FAILED
        (never leave it stuck at IN_PROGRESS) so a genuine retry with
        the SAME key can succeed rather than being permanently blocked
        by a half-finished attempt.

      - INSERT fails with a unique-constraint violation (P2002) →
        another request already claimed this exact (uploadedBy,
        idempotencyKey) pair. Look up the existing row:
          - status: COMPLETED → return the ORIGINAL response (the
            existing ServiceReport's public projection) with the
            existing 201/200 status. No new row, no new storage write,
            no new extraction job enqueued a second time.
          - status: IN_PROGRESS → a genuine concurrent double-submit
            racing right now (e.g. a double-tap that both fired before
            the client-side disabled state took effect). Return 409
            Conflict with a clear message ("This upload is already
            being processed") — the client should not blindly retry;
            the frontend's existing disabled-button behavior already
            makes this rare, this is the server-side backstop for it.
          - status: FAILED → treat as if no claim exists; allow this
            request to retry the claim (re-attempt the INSERT-then-
            proceed path, effectively resuming).
```

This is the same "guarded claim, then act" shape as the rest of this
repo's own concurrency pattern (a unique-constraint-backed atomic claim,
not a plain read-then-write) — consistent with the guarded-`updateMany`
precedent used everywhere else, just applied to an INSERT instead of an
UPDATE since this is a create-only path.

### Client compatibility

- **Fully backward compatible.** The header is optional. Any caller that
  doesn't send `Idempotency-Key` gets exactly today's behavior — no
  behavior change, no new required field, no breaking change to
  `UploadServiceReportDto` or the response shape.
- `apps/field`'s `ServiceReportUploadForm`/`uploadServiceReport()` would
  be updated to always generate one `crypto.randomUUID()` when the form
  is opened (not on every submit attempt — the SAME key is reused across
  retries of the same logical upload attempt, which is the entire point)
  and send it as the header on every attempt for that form session. This
  is a client-only change in `apps/field`, not a schema/API change in
  itself.
- No other current caller of this endpoint exists outside `apps/field`
  (confirmed — the endpoint is only ever called from
  `ServiceReportUploadForm`), so there is no other integration to
  migrate.

### What this explicitly does NOT change

- No change to `ServiceReport`'s own schema, statuses, or any Phase 5
  extraction/verification/confirmation/lock logic — the idempotency
  check happens strictly before the existing upload logic runs, and the
  existing logic is otherwise untouched.
- No change to RBAC — `service_reports.upload` remains the only
  permission gating this route.
- No change to the multipart file-handling path, `MAX_UPLOAD_BYTES`, or
  `ALLOWED_UPLOAD_MIME_TYPES`.

## Alternative considered and rejected: time-window heuristic

Reject a second upload from the same uploader/customer/site/work-order/
report-type within N seconds. Rejected per your instruction to use a
proper idempotency-key design instead — noted here only for completeness:
its downside is that it's imprecise (two *legitimately different*
uploads within the window would be wrongly blocked, and the "right"
window length is a guess) versus the exact-match guarantee of a
client-supplied key.

## Migration (proposed, not applied)

A single new `prisma migrate dev` migration adding:
- `service_report_upload_idempotency_keys` table
- `idempotency_key_status` enum
- The one new unique index (`uploaded_by`, `idempotency_key`)
- The one new unique constraint/index on `service_report_id` (backing the
  `@unique` optional FK)

No existing table, column, index, or enum is altered.

## Tests required (once approved)

- New e2e test: two requests with the same key → exactly one
  `ServiceReport` row created, second response matches the first.
- New e2e test: two requests with the same key issued concurrently
  (`Promise.all`) → exactly one succeeds with `201`, the other gets `409`
  (matching this repo's existing "only one of two concurrent X
  requests... succeeds" test style).
- New e2e test: no `Idempotency-Key` header sent → today's exact
  behavior unchanged (a regression guard proving backward compatibility).
- New e2e test: a `FAILED`-status key can be successfully retried.
- Existing upload e2e tests (`service-reports-upload.e2e-spec.ts`) must
  keep passing completely unmodified.

## Decision needed from you

Confirm this design (header name, per-uploader-scoped uniqueness, no
TTL/cleanup, the `COMPLETED`/`IN_PROGRESS`/`FAILED` state machine) before
I write the migration or any implementation code. Nothing in this
document has been applied.
