# PHASE 4 — FROZEN BASELINE

**Status: APPROVED / COMPLETE / FROZEN.** No further changes to the Work
Order lifecycle, the RBAC/authority matrix, technician assignment/ownership
rules, the Work Order ↔ Service Report relationship, the three Phase 4
frontend-support endpoints, or `apps/web`/`apps/field` Operations
functionality below without explicit approval, documented as a controlled
change. This document is the durable record — the working history lived
only in conversation until now.

## Scope

Phase 4 per the approved roadmap (`rev7-blueprint-summary.md`, "Development
phases"): Work Orders and technician assignment. The backend (schema, RBAC,
lifecycle, numbering, assignment model) was built earlier and already
frozen in practice; this closure covers the **Operations Frontend** —
`apps/web`'s staff-facing Work Order screens, `apps/field`'s
technician-facing screens, and the three minimal read-only endpoints added
to support them. **No Phase 1–3, Phase 5, or Phase 6 schema, lifecycle,
RBAC, OCR/extraction, verification, confirmation, lock, canonical-data, or
Dashboard behavior was touched.**

### Architecture

```
Staff (apps/web)                          Technician (apps/field)
  Create/Schedule/Assign/                   My Jobs (GET /work-orders/mine)
  Complete/Close/Cancel                       → Work Order detail (getForActor,
  Work Order list & detail                      read_own branch)
  Linked Service Reports panel                → Start Job (start_own)
  Dashboard drill-downs                       → Upload Service Report
        │                                            │
        └──────────────► apps/api ◄──────────────────┘
                    WorkOrdersController
                    WorkOrderAssignmentsController
                    ServiceReportsController (+2 new routes)
                    UsersController (+1 new route)
                         │
                    PostgreSQL (unchanged schema)
```

Every new frontend screen is built from this repo's existing shared
component library (`Card`, `Table`, `StatusBadge`, `PageHeader`,
`Breadcrumbs`, `LoadingState`/`EmptyState`/`ErrorState`,
`ActionConfirmDialog`) — no new visual language introduced in `apps/web`.
`apps/field` remains deliberately lightweight — inline styles only, no
Tailwind/shadcn/component-library migration — per the approved design
review decision.

## Work Order lifecycle — states and allowed transitions (frozen)

```
DRAFT ──schedule──► SCHEDULED ──start(own)──► IN_PROGRESS ──complete──► COMPLETED ──close──► CLOSED
  │                     │                          │
  └──────────────────── + ─────────────────────────┘
                         │
                cancellable statuses
                (DRAFT, SCHEDULED, IN_PROGRESS)
                         │
        ┌────────────────┴────────────────┐
   request-cancel                    cancel (direct)
   (records intent only,                   │
    never changes status)                  ▼
        │                              CANCELLED (terminal)
        ├──► dismiss-cancellation-request (clears the open request, no status change)
        └──► cancel (confirms the request; same endpoint as direct cancel)
```

| Transition | Required source status | Endpoint | Notes |
|---|---|---|---|
| Create (standalone) | — | `POST /customers/:id/work-orders` | `workOrderType = STANDALONE` |
| Create (from quotation) | — | `POST /quotations/:id/revisions/:revisionId/convert-to-work-orders` | `workOrderType = FROM_QUOTATION`; requires the revision to be the current `ACCEPTED` one |
| Create (PM maintenance visits) | — | `POST /quotations/:id/revisions/:revisionId/generate-maintenance-visits` | `PREVENTIVE_MAINTENANCE` quotation type only |
| Schedule | `DRAFT` | `PATCH /work-orders/:id/schedule` | Backend requires ≥1 actively-assigned technician before allowing this — verified live |
| Start | `SCHEDULED` | `PATCH /work-orders/:id/start` | Technician-only; also requires the caller to hold an active assignment row for this exact Work Order |
| Complete | `IN_PROGRESS` | `PATCH /work-orders/:id/complete` | |
| Close | `COMPLETED` | `PATCH /work-orders/:id/close` | Terminal administrative sign-off |
| Request cancellation | `DRAFT`/`SCHEDULED`/`IN_PROGRESS` | `PATCH /work-orders/:id/request-cancel` | Records `cancellationRequestedAt`/`Reason` only — never changes `status` |
| Dismiss cancellation request | (open request exists) | `PATCH /work-orders/:id/dismiss-cancellation-request` | Clears the request, no status change |
| Cancel (final authority) | `DRAFT`/`SCHEDULED`/`IN_PROGRESS` | `PATCH /work-orders/:id/cancel` | Works with or without a prior request; terminal |

Every transition endpoint re-validates its own required source status
server-side via a guarded `updateMany` (atomic, race-safe) — the frontend's
status-based button visibility is UX convenience only, never the
authorization boundary.

## RBAC / authority matrix (frozen, verified against `prisma/seed.ts`)

| Permission | Admin/Owner | Manager | Office Staff | Technician |
|---|---|---|---|---|
| `work_orders.create` | ✓ | ✓ | ✓ | – |
| `work_orders.read` (unscoped) | ✓ | ✓ | ✓ | – |
| `work_orders.update` (schedule) | ✓ | ✓ | ✓ | – |
| `work_orders.assign` | ✓ | ✓ | ✓ | – |
| `work_orders.complete` | ✓ | ✓ | ✓ | – |
| `work_orders.close` | ✓ | ✓ | – | – |
| `work_orders.request_cancel` | ✓ | ✓ | ✓ | – |
| `work_orders.cancel` (final) | ✓ | ✓ | – | – |
| `work_orders.generate_maintenance_visits` | ✓ | ✓ | ✓ | – |
| `work_orders.read_own` | – | – | – | ✓ |
| `work_orders.start_own` | – | – | – | ✓ |
| `service_reports.upload` | ✓ | ✓ | ✓ | ✓ |
| `service_reports.read` (unscoped) | ✓ | ✓ | ✓ | – |
| `service_reports.read_own` | – | – | – | ✓ |

No new permission was created for Phase 4 Operations Frontend — every
gate above (including the three new endpoints below) reuses one of these
pre-existing grants. Confirmed via direct inspection of `prisma/seed.ts`
(`ADMIN_MANAGER_PHASE4_GRANTS`, `OFFICE_STAFF_PHASE4_GRANTS`,
`TECHNICIAN_PHASE4_GRANTS`, and the equivalent Phase 5 constants) and via a
passing 403 test for every unscoped route against a Technician-only caller.

## Technician assignment and ownership rules (frozen)

- `WorkOrderAssignment` is **append-only by construction**: `assign()`
  always `INSERT`s a new row; `unassign()` only ever sets
  `unassignedAt`/`unassignedBy` on an existing row via a guarded
  `updateMany` — nothing in the codebase ever `UPDATE`s a row's
  `technicianId` or `DELETE`s a row. "Reassignment" in the UI is always
  modeled as unassign + assign, never a single reassign call.
- A technician cannot be double-assigned to the same Work Order while
  already active — enforced at the application level (`existingActive`
  check) and at the database level (partial unique index on
  active-assignment rows, `work_order_assignments_active_technician_key`),
  caught as `P2002`.
- `GET /work-orders/:id` (`getForActor`) carries no static `@Permissions()`
  — it resolves the caller's effective permissions itself: holders of
  `work_orders.read` see any Work Order; holders of only `work_orders.read_own`
  see it only if they have an active assignment row on it, else `403`;
  holders of neither get `403`.
- `GET /work-orders/mine` (`listForTechnician`) filters at the query
  itself (`assignments: { some: { technicianId, unassignedAt: null } }`)
  — an ended assignment stops appearing immediately, not via
  post-fetch filtering.
- `PATCH /work-orders/:id/start` (`startOwn`) independently re-checks both
  the `SCHEDULED` source status and an active-assignment row for the
  caller before the atomic transition — the guard and the service method
  enforce two different things and both must pass.
- The technician picker (`GET /users/technicians`, see below) defines
  "technician" by the `work_orders.start_own` **permission grant**, not by
  a hardcoded role name — correct in a permission-driven system where role
  names are arbitrary data.

## Work Order ↔ Service Report relationship (frozen)

- `ServiceReport.workOrderId` is nullable and optional at upload time
  (`UploadServiceReportDto.workOrderId?`) — a Work Order linkage is
  additive, never required.
- `GET /work-orders/:id/service-reports` lists only reports whose
  `workOrderId` matches, using the exact same `toPublicServiceReport`
  projection as every other Service Report response — `documentFileKey`
  is never exposed.
- **Confirmed by code inspection that a Work-Order-linked upload does not
  bypass any stage of the Phase 5 pipeline.** `ServiceReportsService.upload()`
  creates the row with `status: PENDING_EXTRACTION` and unconditionally
  calls `extractionQueue.enqueueExtraction()` in the same transaction path,
  regardless of whether `workOrderId` is set — the field is only a foreign
  key, it never branches into a different status or skips a stage. Zero
  "Phase 4" markers exist anywhere near the `verify`/`confirm`/`lock`
  methods or in the extraction processor file; those remain completely
  untouched. The full pipeline (
  `PENDING_EXTRACTION → PENDING_VERIFICATION/EXTRACTION_FAILED → VERIFIED
  → CONFIRMED → LOCKED`) still applies identically whether or not a Work
  Order is attached.
- `apps/field`'s upload form hands off entirely into this existing
  pipeline via the pre-existing `POST /customers/:id/service-reports` —
  no OCR/extraction/verification/confirmation/lock logic is duplicated
  anywhere in Phase 4 code.

## The three Phase 4 frontend-support endpoints (frozen)

| Endpoint | Permission | Returns | Notes |
|---|---|---|---|
| `GET /users/technicians` | `work_orders.assign` | `{id, fullName, status}[]` | Filtered by the `work_orders.start_own` permission grant, deliberately narrower than the general user-list projection (no email/phone/lastLoginAt) |
| `GET /work-orders/:id/service-reports` | `service_reports.read` | `PublicServiceReport[]` scoped to that Work Order | Reuses `ServiceReportsService.listByWorkOrder()` and its existing safe projection |
| `GET /service-reports/types` | `service_reports.upload` | `{code, label, sortOrder}[]`, `ReferenceStatus.ACTIVE` only | Added after a live-approved follow-up decision (not one of the original two Decision-1 endpoints); lets `apps/field`'s upload form populate a real Report Type dropdown from the `service_report_types` reference table instead of a hardcoded list |

No new permission and no schema change for any of the three. Each has a
passing 403 test against a caller lacking the relevant grant.

## `apps/web` — final Operations functionality

- **`/work-orders`** — global staff list (Suspense-wrapped for
  `useSearchParams()`), optional `?status=` filter, one enriched API call
  showing Work Order #, Customer, Site, Type, Scheduled date, Status, and
  Technician(s) — no per-row follow-up fetch.
- **`/work-orders/[id]`** — detail page: header, Details card, Actions
  (`WorkOrderLifecycleActions`), Technician Assignment
  (`WorkOrderAssignmentPanel`), Linked Service Reports
  (`WorkOrderServiceReportsPanel`, linking out to the existing
  `/service-reports/:id/verify` page for every status — no branching, no
  duplicated verification UI).
- **Customer detail page** — new "Work Orders" tab (`WorkOrdersTab`),
  mirrors the existing Quotations/Inquiries tab pattern; "New Work Order"
  opens `CreateWorkOrderDialog` (standalone creation).
- **Quotation detail page** — `ConvertToWorkOrdersPanel`, shown only when
  the current revision is `ACCEPTED`: "Convert to Work Order" (any type)
  and "Generate Maintenance Visits" (`PREVENTIVE_MAINTENANCE` only).
- **Dashboard** — the three existing Work Order KPI cards now link to
  `/work-orders?status=SCHEDULED`, `/work-orders?status=IN_PROGRESS`, and
  `/work-orders?status=SCHEDULED,IN_PROGRESS` respectively (the
  Cancellation-Requested card links to the same set the backend can
  actually filter by — there is no dedicated cancellation-request status
  filter). This is the one change to the otherwise-frozen Phase 6
  Dashboard file, pre-approved as Decision 2.

## `apps/field` — final Operations functionality

- **`hasPermission()`** added to `auth-context.tsx` (same `PermissionRef`
  shape and logic as `apps/web`'s own).
- **My Jobs** (`/home`, replacing the Phase 1 stub) — lists the
  technician's actively-assigned jobs via `GET /work-orders/mine`,
  permission-gated on `work_orders.read_own`, with loading/empty/error
  states.
- **Job detail** (`/jobs/[id]`) — reads via `getForActor`'s `read_own`
  branch; shows job details, `StartJobButton`, and the Service Report
  upload form.
- **Start Job** (`StartJobButton`) — `work_orders.start_own`,
  `SCHEDULED`-only, calls `PATCH /work-orders/:id/start`.
- **Service Report upload** (`ServiceReportUploadForm`) —
  `service_reports.upload`, populates its Report Type dropdown from the
  new `GET /service-reports/types`, uploads via the existing
  `POST /customers/:id/service-reports` with `workOrderId` set. Shown
  once the job is `IN_PROGRESS` or `COMPLETED`.
- Kept deliberately lightweight per the approved design decision: inline
  styles only, no Tailwind/shadcn, mobile-first with ≥44px touch targets.
- **Mobile CSS fix**: a global `box-sizing: border-box` reset was added to
  `layout.tsx` after live mobile testing found the `card` style
  overflowing the viewport (missing `box-sizing`). This also incidentally
  fixed a pre-existing Phase 1 overflow bug on the login page. Re-verified
  clean after the fix: full test suite, typecheck, lint, and production
  build.

Technician does **not** have a "Mark Completed" or "Close" action anywhere
in `apps/field` — by design, matching the RBAC matrix above exactly
(`work_orders.complete`/`close` are Office Staff+/Manager+ only).

## Final automated test totals

| Suite | Result |
|---|---|
| Backend unit | 334/334 passing (unchanged) |
| Backend E2E | 224/224 passing (222 baseline + 2 new for `GET /service-reports/types`) |
| `apps/web` frontend (Vitest) | 126/126 passing (75 baseline + 51 new) |
| `apps/field` frontend (Vitest, new infrastructure) | 25/25 passing |
| Backend/`apps/web`/`apps/field` typecheck | clean |
| Backend/`apps/web`/`apps/field` lint | clean (2 pre-existing, unrelated warnings in an untouched Phase-4-backend-era e2e file) |
| Production build (`apps/web`, `apps/field`) | clean |

## Live end-to-end validation (real dev server, real Postgres, real browser)

Full staff → technician → staff flow, walked end to end against real data:

1. Admin/Owner created a standalone Work Order, assigned a technician —
   scheduling was correctly rejected by the backend until a technician was
   assigned, then succeeded.
2. The assigned Technician logged into `apps/field`, saw the job in My
   Jobs, opened it, and started it (`SCHEDULED → IN_PROGRESS`).
3. The Technician uploaded a Service Report against that Work Order — real
   multipart upload, real Report Type dropdown from the new endpoint, real
   Service Report number returned.
4. Staff saw the linked Service Report on the Work Order detail page
   (status `EXTRACTION_FAILED`, expected — the stub OCR provider always
   fails, and the test file was synthetic).
5. Admin/Owner marked the Work Order Completed, then Closed.
6. Cancellation workflows validated separately on other Work Orders:
   request → dismiss (returns to normal, no status change), and request →
   direct cancel (terminal `CANCELLED`, reason recorded).
7. All three Dashboard Work Order drill-down links verified to navigate to
   the correct filtered `/work-orders` view.
8. Mobile viewport (375×812) confirmed clean on `apps/field`'s My Jobs and
   Job Detail screens after the box-sizing fix.
9. The complete audit trail for every step above was independently
   confirmed via `GET /audit-logs` (login, work_order_started,
   service_report_uploaded, service_report_extraction_enqueued/attempted,
   work_order_completed, work_order_closed, work_order_cancellation_requested,
   work_order_cancellation_dismissed).

## Quotation → Work Order conversion — closure-audit finding

**Classification: `PRE-EXISTING NON-BLOCKING ISSUE`.**

The live-click path for `ConvertToWorkOrdersPanel` was not completed end
to end during validation, for two reasons established by DB state, audit
log inspection, and code review — neither implicates Phase 4 code:

1. A Phase 3/6 demo-seeded quotation (`QT-DEMO6-acc-ptdj`) has
   `Quotation.status = "ACCEPTED"` but **zero** `QuotationRevision` rows —
   a seed-data artifact from earlier demo/dashboard fixtures, never
   produced through the real lifecycle. Since `ConvertToWorkOrdersPanel`
   correctly gates on the *revision's* `status === "ACCEPTED"`, and no
   revision exists, the page never leaves "Loading revision…" — Phase 4's
   panel code is never reached.
2. A freshly created test quotation's "Submit for Approval" click left no
   trace in the audit log at all (only `quotation_created` and
   `revision_created` exist) — conclusive evidence the click never
   reached the backend, consistent with a stale dialog overlay observed
   in real time during that session. `submitRevision()`'s actual
   requirements (`DRAFT` status, ≥1 line item) were fully satisfied, and
   the identical scenario is covered by passing `quotation-lifecycle.e2e-spec.ts`
   tests. Even a successful submit would only have reached
   `PENDING_APPROVAL`/auto-`APPROVED` — three more steps
   (approve → send → record decision) were never attempted.

The Phase 4 backend routes (`convert-to-work-orders`,
`generate-maintenance-visits`) predate the Operations Frontend work,
were not modified by it, and remain covered by 9+ passing e2e tests
across three spec files. The Phase 4 frontend component
(`ConvertToWorkOrdersPanel`) has 8/8 passing unit tests against the real
API contract. No Phase 3 code was modified in the course of this
investigation or to force a live pass.

## Carry-forward, non-blocking items (do not lose these after freeze)

1. **Pre-existing Phase 3/6 seed artifact**: `QT-DEMO6-acc-ptdj` has
   `ACCEPTED` status with no revision rows — cosmetic/demo-data only, does
   not affect any quotation created through the real lifecycle.
2. **Minor test-coverage gap**: `GET /service-reports/types`'s e2e test
   confirms response shape and minimum fields but does not create an
   explicit `INACTIVE` fixture to assert exclusion — code inspection
   confirms the query (`where: { status: ACTIVE }`) is unambiguous, but a
   dedicated assertion would close the gap.
3. **Live-testing note**: Radix Dialog exit-animations briefly remained
   clickable/overlaying during rapid live-browser validation, causing
   several clicks to silently miss their target on first attempt (all
   succeeded on retry with a brief pause). Not a product defect — a
   caution for future live-validation sessions.
4. **Test artifacts remaining in the development database** (kept intact,
   not deleted, per instruction):
   - User: **Phase4 Field Technician** (`phase4-field-tech@example.test`)
   - Work Order: **WO-2026-08-01195** (`CLOSED`)
   - Service Report: **SR-2026-08-00087** (`EXTRACTION_FAILED` — expected)
   - Quotation: **QT-2026-08-02936** (`DRAFT`, 1 line item)

## Explicitly not introduced in Phase 4 Operations Frontend

No new permission, no schema/migration change, no new runtime dependency
in `apps/api` or `apps/web` (only new **devDependencies** — Vitest/React
Testing Library — in `apps/field`, approved as new test infrastructure),
no OCR/storage/extraction-provider change, no Work Order ↔ Equipment
relationship, no `WorkOrderTask`/`WorkOrderActualCost` UI, no duplication
of any Phase 5 verification/confirmation/lock logic.

## Change control

No further changes to the Work Order lifecycle/transition rules, the
RBAC/authority matrix, technician assignment/ownership rules, the Work
Order ↔ Service Report relationship, the three frontend-support endpoints,
or `apps/web`/`apps/field` Operations functionality above without explicit
approval, documented as a controlled change. The frozen Phase 1–3, 5, and
6 architecture (`phase5-extraction-reliability-baseline.md`,
`phase5-step5-verification-baseline.md`, `phase5-step6-confirm-baseline.md`,
`phase5-step7-lock-baseline.md`, `phase6-dashboard-baseline.md`) was not
modified by this work.
