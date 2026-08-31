# Phase 6 — Dashboard

**Status: APPROVED / COMPLETE / FROZEN.** No further changes to the KPI
set, the role visibility rule, the new endpoints' permission gates, the
informational-only Work Orders treatment, or the Recent Activity
availability rule below without explicit approval. This document is the
durable record — the working history lived only in conversation until now.

## Scope

Phase 6 per the approved roadmap (`rev7-blueprint-summary.md`, "Development
phases"): a single operational overview screen, replacing the Phase 1
placeholder dashboard. Built entirely on data and endpoints that already
existed after Phase 5, plus two new minimal list endpoints and one new
minimal index page, all reusing existing permissions. **No Phase 1–5
schema, lifecycle, RBAC, OCR/extraction, verification, confirmation, lock,
or canonical-data behavior was touched.**

## Purpose and information architecture

A read-only, single-page operational overview for people who need to see
what needs attention now and what happened recently — not an analytics or
reporting product. Layout, top to bottom: header (name/role/sign-out) → a
responsive KPI card grid → Recent Activity. Every section is reused from
the app's existing design system (`Card`, `Table`, `Badge`,
`LoadingState`/`EmptyState`/`ErrorState`) — no separate Dashboard visual
language was introduced.

## Final KPI cards and operational queues, with exact source

| Card | Exact source | Drill-down |
|---|---|---|
| Active Customers | `Customer.status = ACTIVE`, counted client-side from `GET /customers` | `/customers` |
| Service Reports — Pending Verification | `ServiceReport.status = PENDING_VERIFICATION` via `GET /service-reports?status=PENDING_VERIFICATION,VERIFIED,CONFIRMED` (one call, split client-side) | `/service-reports` |
| Service Reports — Verified | `status = VERIFIED`, same call | `/service-reports` |
| Service Reports — Confirmed | `status = CONFIRMED`, same call | `/service-reports` |
| Quotations — Pending Approval | `Quotation.status = PENDING_APPROVAL` via `GET /quotations?status=PENDING_APPROVAL,SENT` | `/quotations?status=PENDING_APPROVAL` |
| Quotations — Awaiting Customer Decision | `status = SENT`, same call | `/quotations?status=SENT` |
| Work Orders — Scheduled | `WorkOrder.status = SCHEDULED` via `GET /work-orders?status=SCHEDULED,IN_PROGRESS` | none (informational only) |
| Work Orders — In Progress | `status = IN_PROGRESS`, same call | none (informational only) |
| Work Orders — Cancellation Requested | `cancellationRequestedAt IS NOT NULL AND cancelledAt IS NULL`, same call, filtered client-side | none (informational only) |
| Recent Activity | most recent 10 rows from `GET /audit-logs?take=10` | none |

Every number is a direct, unmodified count over rows returned by an
existing (or newly added but permission-identical) list endpoint — no
computed/derived business metric, no aggregate table, no date-range query.

## Role visibility matrix (final)

| Section | Admin/Owner | Manager | Office Staff | Technician |
|---|---|---|---|---|
| Active Customers | ✓ | ✓ | ✓ | — |
| Service Reports KPIs | ✓ | ✓ | ✓ | — |
| Quotations KPIs | ✓ | ✓ | ✓ | — |
| Work Orders KPIs (informational) | ✓ | ✓ | ✓ | — |
| Recent Activity | ✓ | ✓ | — | — |

Each row is gated on the viewer already holding the corresponding
module's existing `read` permission (`customers.read`,
`service_reports.read`, `quotations.read`, `work_orders.read` — the
**unscoped** variant only, not `read_own`) or, for Recent Activity,
`audit_logs.read`. No new "dashboard" permission was created or checked
anywhere in this codebase. Technician holds none of these five permissions
under the existing, unchanged RBAC seed, so every section is correctly
absent for them.

### The omission rule: not fetched, not merely hidden

`dashboard/page.tsx` wraps every section's data fetch in an `if
(canReadX)` guard — a viewer lacking a permission never calls that
endpoint at all, not just skips rendering its result. **Live-verified via
the browser's own network request log**, not just the DOM: for an Office
Staff session, `GET /audit-logs` was never requested; for a Technician
session, none of `GET /customers`, `GET /service-reports`, `GET
/quotations`, `GET /work-orders`, or `GET /audit-logs` were requested at
all after login.

## New endpoints

- **`GET /quotations?status=...`** (`QuotationsController.list`,
  `QuotationsService.listAllOrByStatus`) — global, cross-customer listing,
  optionally filtered by a comma-separated `QuotationRevisionStatus` list;
  no filter returns every quotation. Gated on the existing
  `quotations.read`.
- **`GET /work-orders?status=...`** (`WorkOrdersController.list`,
  `WorkOrdersService.listAllOrByStatus`) — same shape, gated on the
  existing `work_orders.read` (unscoped only — `read_own` does not unlock
  this route; Technician's own jobs remain reachable only via the
  pre-existing `GET /work-orders/mine`, which has no frontend consumer
  yet).

Both mirror `GET /service-reports?status=...`'s exact precedent from
Phase 5 Step 5/6 — same comma-separated-status convention, same
permission-only gating, no new permission, no aggregate table, no schema
change.

## Minimal `/quotations` index page

Added solely because individual `/quotations/[id]` pages already existed
with no list page to reach them from — the Dashboard's Quotation KPI cards
needed a real destination. Reads an optional `?status=` from the URL
(`useSearchParams`, wrapped in a `Suspense` boundary — see the resolved
deviation below) and passes it straight through to `listQuotations`. No
create/edit action, no filters beyond status, same shared
Card/Table/StatusBadge/loading-empty-error components every other list
page already uses. **Not a quotation-module redesign** — this remains its
full scope.

## Existing Dashboard drill-down destinations

| KPI group | Destination | Status |
|---|---|---|
| Customers | `/customers` | pre-existing page |
| Service Reports (all three) | `/service-reports` | pre-existing page (already lists `PENDING_VERIFICATION`/`VERIFIED`/`CONFIRMED` since Phase 5 Steps 6–7) |
| Quotations (both) | `/quotations?status=...` | new in Phase 6 |
| Work Orders (all three) | none | informational only — see below |

## Work Order KPI/queue — informational only

**No Work Orders frontend exists anywhere in the product** (neither
`apps/web` nor `apps/field`) as of Phase 6. The three Work Order KPI cards
are therefore rendered without an `href` — `KpiCard` renders a plain,
non-interactive `Card` (no `<a>` tag, no hover affordance) whenever `href`
is omitted, and each carries the caption "Work Order detail pages are not
yet available." **Verified in the browser's accessibility tree**: the
three Work Order cards render as plain `generic` nodes, never as `link`
nodes, unlike every other KPI card. This remains informational-only until
a future phase builds a Work Orders frontend — no drill-down is faked.

## Recent Activity availability

Gated on `audit_logs.read` exactly as already seeded (Admin/Owner via the
"every permission" grant, Manager via an explicit grant) — Office Staff and
Technician hold neither, so this section is absent for both, confirmed via
the network-request-log check above (not merely a hidden DOM element).

## Technician Dashboard — intentionally minimal

Technician's Dashboard shows only their name and role — zero KPI/queue/
Recent-Activity sections, all correctly absent per the permission-gated
fetch rule above. **This is a deliberate, approved design choice, not a
gap to close by broadening permissions.** Technician's existing scoped
capabilities (`work_orders.read_own`, `service_reports.upload`,
`service_reports.read_own`) have no corresponding frontend destination
today; a self-scoped Technician operational view (e.g. "my assigned
jobs") remains explicitly deferred until a technician-facing frontend
workflow is designed and built — not part of Phase 6.

## Explicitly not introduced in Phase 6

No charting library, no historical/date-range analytics or filters, no
aggregate table, no new "dashboard" permission, no schema change of any
kind. `Quotation.status`/`WorkOrder.status` were already indexed
(`@@index([status])`) before this phase — no index was added.

## Test baseline (frozen reference point)

| Suite | Result |
|---|---|
| Backend unit | 334/334 passing (unchanged — Quotations/Work Orders continue this repo's e2e-only test precedent for those two modules) |
| Backend E2E | 213/213 passing (203 baseline + 10 new, in `phase6-dashboard-list-endpoints.e2e-spec.ts`) |
| Frontend (Vitest) | 75/75 passing (57 baseline + 18 new) |
| Production build (`next build`) | clean |
| Backend/frontend typecheck | clean |
| Backend/frontend lint | clean (2 pre-existing, unrelated warnings in an untouched Step-4-era e2e file) |

### Live end-to-end validation (real dev server, real Postgres, real browser — all four roles)

Seeded representative data (1 active customer; quotations spanning
`DRAFT`/`PENDING_APPROVAL`/`SENT` ×2/`ACCEPTED`; work orders spanning
`SCHEDULED`/`IN_PROGRESS` ×2 (one with an open cancellation request)/
`COMPLETED`) and cross-checked every dashboard number directly against a
PostgreSQL query before testing — **all values matched exactly**
(1 active customer; 0/0/2 Service Report statuses; 1 pending-approval and
2 sent quotations; 1 scheduled, 2 in-progress, 1 open-cancellation-request
work order).

- **Admin/Owner**: all 5 sections rendered with exactly the expected
  counts; every Customers/Service-Reports/Quotations drill-down link
  followed through correctly to real data; Work Order cards confirmed
  non-interactive; mobile layout (375×812) confirmed to stack cleanly to
  one column with no overflow.
- **Manager**: identical section set and counts to Admin/Owner, as
  expected from the identical underlying permission grant.
- **Office Staff**: 4 sections rendered (no Recent Activity); network log
  confirmed `GET /audit-logs` was never requested.
- **Technician**: zero sections rendered, correct "no operational
  Dashboard sections" message; network log confirmed **no** Dashboard API
  call of any kind was made after login.

## Resolved deviations discovered during implementation

1. **`useSearchParams()` Suspense requirement (real bug, fixed before
   freeze)**: `next build` failed on `/quotations` with "useSearchParams()
   should be wrapped in a suspense boundary." Found by deliberately running
   a production build to check for exactly this class of issue. Fixed by
   splitting the page into a `Suspense`-wrapped default export and an inner
   component holding the real logic — the standard Next.js App Router
   pattern for this hook.
2. **Test-environment interference (not code regressions)**, both
   root-caused via direct reproduction rather than dismissed:
   - A dev server left running from the prior (Step 7) session was
     competing with an e2e test's own isolated Nest application instance
     for the same Redis-backed BullMQ queue, causing one extraction test
     to observe the real (unmocked) stub provider's result instead of the
     test's overridden fake provider. Confirmed via a standalone
     reproduction script and resolved by stopping the leftover server.
   - A pre-existing timing race in `service-reports-upload.e2e-spec.ts`
     between its synchronous post-upload audit-entry assertion and the
     async queue processor's own audit write, reproducible only under
     certain scheduling. Confirmed passing reliably in isolation; entirely
     unrelated to any Phase 6 code (upload/queue code was never touched).
3. Running `next build` against the same `.next` directory an active dev
   server was serving from corrupted the dev server's incremental cache —
   an operational mistake during validation, not a code defect. Resolved
   by deleting `.next` and restarting cleanly.

## Remaining accepted limitations / deferred items

- Work Order KPIs/queue remain informational-only pending a future Work
  Orders frontend (any phase).
- No charts, no historical/date-range analytics — deferred until
  sufficient operational history and real reporting requirements exist.
- `/quotations` remains intentionally minimal (no create/edit, no filters
  beyond `?status=`) — expanding it is a future decision, not implied by
  Phase 6.
- Technician's Dashboard stays minimal until a self-scoped
  technician-facing frontend workflow (built on `work_orders.read_own`,
  `service_reports.upload`, `service_reports.read_own`) is separately
  designed and built.

## Change control

No further changes to the KPI set, the role visibility rule, the new
endpoints' permission gates, the informational-only Work Orders treatment,
the Recent Activity availability rule, or the minimal `/quotations` scope
above without explicit approval. The frozen Phase 1–5 architecture
(`phase5-extraction-reliability-baseline.md`,
`phase5-step5-verification-baseline.md`,
`phase5-step6-confirm-baseline.md`, `phase5-step7-lock-baseline.md`) was
not modified by this work.
