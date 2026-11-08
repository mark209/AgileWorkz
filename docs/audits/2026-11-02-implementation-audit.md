# AgileWorks HVAC ERP — Current Implementation Audit

**Audit date:** 2026-11-02  
**Scope:** Repository and tests, current Render service/deployment metadata, and prior read-only browser observations from the deployed Office app. No new production records were created or changed during this audit.  
**Evidence rule:** Source presence and a passing unit/UI test do not prove a deployed workflow. Live database-backed E2E and end-user role behavior are marked unverified where they could not be safely exercised.

## Executive assessment

AgileWorks is a multi-application ERP with real customer, sales, equipment, work-order, service-report, and dashboard code. The README was materially out of date and described only Phase 1; it has been corrected. Several critical integrations are still incomplete or configured in a way that bypasses expected behavior:

1. Service-report upload currently creates a `DOCUMENT_ONLY` report in `PENDING_VERIFICATION`; it does not enqueue the extraction worker. The configured Render extraction provider is `stub`, which always returns failure. OCR code and isolated extraction tests exist, but the deployed upload-to-OCR workflow is not operational.
2. The customer quotation path is intentionally blocked from sending until actual commercial Terms & Conditions replace the seeded placeholder. Do not invent or publish contractual terms to remove this block.
3. Existing E2E tests cover individual state machines and permissions, but do not prove the entire cross-module customer-to-closed-work-order workflow in one run.
4. Current local test configuration targets a hosted Supabase database and has no Redis URL. Docker is unavailable in this environment. Database E2E tests were not run because the target cannot be proven isolated from production.
5. Purchasing/inventory, supplier management, invoicing/collections/AR, accounting integration, and HR/timekeeping are not present as ERP modules.

**Recommendation:** Not ready for an operational pilot that depends on OCR, customer quotation sending, finance/inventory control, or verified end-to-end behavior. A limited workflow pilot could be considered only after the desired service-report policy and commercial terms are confirmed, and after the role workflows pass against a clearly isolated staging database.

## Architecture found

- **API:** NestJS modular monolith, TypeScript, Prisma/PostgreSQL, JWT authentication, permission guards, audit logging, Redis/BullMQ background processing, object-storage abstraction.
- **Office app:** Next.js app with member management, customer/site/inquiry records, quotations/revisions/approvals, work orders/dispatch, service-report review, and operational dashboard.
- **Field app:** Separate Next.js technician PWA with sign-in, assigned-job list/detail, start/field completion, and service-report upload.
- **Database:** Prisma schema and migrations contain customer/sales/equipment/operations/report/staging/canonical/audit entities. The schema is far beyond the seven-table Phase 1 description still present in older docs.
- **Deployment:** Render has separate public API, Office, and Field services. The services are configured for manual deployment. Latest live deployment metadata returned for the API and Office app points to commit `f0652bcc551b55dcf89391dd7e89b4364bff4b4e` (2026-10-22). Render environment values and live database contents were not inspected.

Primary evidence: `apps/api/src/modules/`, `apps/web/src/app/`, `apps/field/src/app/`, `prisma/schema.prisma`, `prisma/migrations/`, `render.yaml`.

## Feature implementation matrix

| Feature | Status | Evidence and notes |
|---|---|---|
| Authentication, members, registration, role assignment | Implemented; code/unit tests present; live role behavior unverified | `apps/api/src/modules/identity/`; `apps/web/src/app/members/`; `apps/api/test/auth.service.spec.ts`, `users.service.spec.ts`, `registration.service.spec.ts`, `e2e/auth-rbac.e2e-spec.ts` |
| Permission-driven RBAC and record scope | Implemented; DB-backed validation not run in this environment | `apps/api/src/common/guards/`; `apps/api/src/modules/identity/permissions.service.ts`; `prisma/seed.ts`; `apps/api/test/permissions.guard.spec.ts`, `e2e/auth-rbac.e2e-spec.ts`, `e2e/work-order-assignments.e2e-spec.ts` |
| Customers, contacts, sites, inquiries | Implemented; UI/API tests exist | `apps/api/src/modules/customers/`; `apps/web/src/app/customers/`, `sites/`, `inquiries/`; related service and E2E specs |
| Equipment systems, asset records, service history/warranty fields | Implemented in part; broader lifecycle and maintenance trend reporting unverified | `apps/api/src/modules/equipment/`, `equipment-reference/`; `prisma/schema.prisma` models `EquipmentSystem`, `Asset`; equipment E2E specs |
| Quotation creation, revisions, line items, costing fields, PDF | Implemented; tests exist | `apps/api/src/modules/quotations/`; `apps/web/src/app/quotations/`; quotation lifecycle/pricing/revision specs |
| Quotation approvals and rejection | Implemented; Manager then Owner escalation is tested in E2E files, not run here | `quotation-approval-threshold.util.ts`; `e2e/quotation-two-level-approval.e2e-spec.ts`, `e2e/quotation-lifecycle.e2e-spec.ts` |
| Customer acceptance and quotation send tracking | Implemented as manually recorded states; actual outbound email/customer portal is absent | `apps/api/src/modules/quotations/quotations.service.ts`; UI explicitly says approved PDF is sent outside the system in `apps/web/src/components/quotations/lifecycle-action-bar.tsx` |
| Work orders, scheduling, assignments, cancellation, closure | Implemented; individual lifecycle/assignment/maintenance E2E specs exist | `apps/api/src/modules/work-orders/`; `apps/web/src/app/work-orders/`; `apps/field/src/app/jobs/`; `e2e/work-order-lifecycle.e2e-spec.ts`, `work-order-assignments.e2e-spec.ts`, `work-order-maintenance-generation.e2e-spec.ts` |
| Technician field work and report upload | Implemented in UI/API; deployed cross-app workflow not re-tested in this audit | `apps/field/src/app/jobs/`; `apps/field/src/components/service-report-upload-form.tsx`; `e2e/service-reports-upload.e2e-spec.ts` |
| Technician offline job viewing and report queue | Implemented in the local code; not deployed or visually verified in a browser. Recent assigned jobs and report types are cached per technician for 12 hours; offline report uploads persist locally and sync after same-user sign-in. Job status changes remain online-only. | `apps/field/src/lib/offline-store.ts`, `offline-sync.ts`, `components/offline-sync-status.tsx`, `public/sw.js`; 47 Field tests pass. Browser IndexedDB stores are not app-encrypted; pilot use requires screen-locked managed devices. |
| Recurring preventive-maintenance visit generation | Implemented for maintenance quotations; tests exist; full dispatch and billing cycle unverified | `generate-maintenance-visits` in `apps/api/src/modules/work-orders/`; `e2e/work-order-maintenance-generation.e2e-spec.ts` |
| Service-report upload and document storage | Implemented; upload security/idempotency tests exist | `apps/api/src/modules/service-reports/service-reports.service.ts`; `e2e/service-reports-upload-idempotency.e2e-spec.ts` |
| OCR/AI extraction and staging | Upload-to-queue path is implemented for `EXTRACTION_PROVIDER=vertex-gemini`; verified by service unit tests. Not operational on current Render configuration | `service-reports.service.ts` now creates `PENDING_EXTRACTION` / `EXTRACTED_FIELDS` reports and enqueues the document when the real provider is configured. Queue failures retain the report and mark it `EXTRACTION_FAILED`. `render.yaml` still sets `EXTRACTION_PROVIDER=stub`, whose provider always returns failure; no Render settings were changed. |
| Human verification, confirmation, canonical data, locking | Implemented for extracted-field workflows and document-only approval; current upload uses document-only path | `apps/api/src/modules/service-report-verification/`, `service-report-confirmation/`; `e2e/service-report-verification.e2e-spec.ts`, `service-report-confirmation.e2e-spec.ts`, `service-report-lock.e2e-spec.ts` |
| Dashboard | Implemented as operational queues and recent audit activity; not full financial/production BI | `apps/web/src/app/dashboard/`; `apps/api/test/e2e/phase6-dashboard-list-endpoints.e2e-spec.ts` |
| Settings and audit history | Implemented; DB-level audit immutability script exists; production grants not independently checked | `apps/api/src/modules/settings/`, `audit/`; `infra/sql/test-audit-log-permissions.sql` |
| Purchase requests/orders, suppliers, inventory, stock/material/refrigerant tracking | Not implemented | No corresponding API modules, UI routes, or Prisma business models found |
| Customer billing, invoices, AR, collections, expenses, accounting integration | Not implemented | Maintenance billing frequency and quotation costing fields are not an invoicing or accounting workflow; no billing/AR modules or models found |
| HR, attendance, timesheets, overtime, leave, reimbursements, certification records | Not implemented | No corresponding API modules, UI routes, or Prisma business models found |
| Notifications/reminders | Not implemented as outbound notifications | No email/SMS delivery integration found; quotation sending is manual and PMS reminders are not shown as a notification service |

## Role and permission review

| Role | Intended responsibility in seeded permissions | What is evidenced | Verification result |
|---|---|---|---|
| Admin/Owner | System administration; broad configuration; high-value approval; document-only report approval and locking | Role grants in `prisma/seed.ts`; two-level approval and report permission E2E specs | Source and tests found; live user-session checks not run during this audit |
| Manager | Operational oversight; Level 1 quotation approval; work-order close/final cancellation; review | Grants in `prisma/seed.ts`; quotation/work-order/report E2E specs | Source and tests found; live behavior not verified |
| Office Staff | Customer/sales record maintenance; quotation preparation; work-order creation/dispatch; report processing | Grants in `prisma/seed.ts`; Office UI routes and component tests | Source and tests found; live behavior not verified |
| Technician | Read own assigned work; start/complete own field portion; upload own report | `read_own`, `start_own`, `field_complete_own` grants and assignment checks; Field app | Source and tests found; live behavior not verified |

The permission service unions role grants and resolves them from the database for each request (`apps/api/src/modules/identity/permissions.service.ts`). This supports fast role revocation in principle. Current DB-backed revocation, reassignment, cross-record, and session-expiry behavior was not exercised here.

## End-to-end workflow assessment

| Workflow step | Current state |
|---|---|
| Customer → Site → Inquiry | Implemented in Office app and API; API E2E coverage exists |
| Inquiry → Quotation → revision → approval/rejection | Implemented; quotation lifecycle and two-level approval E2E coverage exists |
| Approved quotation → customer PDF/send/acceptance | PDF and manual state recording exist; send is external and blocked while placeholder T&C remain |
| Accepted quotation → Work Order / recurring maintenance visits | Implemented; work-order conversion/generation E2E coverage exists |
| Work Order → schedule → technician assignment → field start/completion | Implemented; state-machine and assignment E2E coverage exists |
| Field completion → report upload | Implemented; upload uses file signature checks and idempotency |
| Upload → OCR queue → staging → human review | Code path enqueues extraction when the real provider is configured; current Render deployment remains document-only because it uses `stub`. Database-backed end-to-end execution was not run because the available database URL could not be proven isolated. |
| Verify → confirm → canonical data → lock | Code and individual E2E suites exist; actual database-backed flow from a fresh uploaded report remains unverified. |
| Work Order closure → operational dashboard | Closure and dashboard implemented separately; one cross-module E2E proving the full linked journey was not found |
| Billing → collection → profitability | Not implemented |

## Verification performed

- `pnpm typecheck`: passed for API, Office, Field, and shared types.
- `pnpm lint`: completed with no errors; two existing unused-variable warnings at `apps/api/test/e2e/work-order-maintenance-generation.e2e-spec.ts:172` (`quotationId`, `revisionId`).
- API production build: passed.
- Field and Office production builds: passed. Both emitted Next.js 14.2.35, which is unsupported and flagged in the existing `SECURITY_AUDIT.md`.
- Offline Field follow-up: all 47 Field unit/component tests passed; workspace typecheck, Field lint, and Field production build passed. A local browser render check was blocked twice by the browser localhost approval gate timing out; the hosted site was not used because it has not received these changes.
- API unit tests: 41 of 42 suites passed; 399 tests passed. Three trust-proxy cases failed to bind localhost ports (`EACCES`) due to sandbox restrictions. These are unverified here, not established product defects.
- Office Vitest suite: blocked before tests executed by temporary-file rename `EPERM` errors in the sandbox. The Field Vitest runner stalled before reporting cases and had to be stopped; no Field test result is available.
- Database E2E: not run. Local `DATABASE_URL` resolves to hosted Supabase; local `REDIS_URL` is absent and Docker is unavailable. It would be unsafe to run the destructive-prefix cleanup against an environment not proven to be isolated.
- Render: metadata shows public API, Office, and Field services with manual deploys; API and Office latest live deploy records use commit `f0652bcc551b55dcf89391dd7e89b4364bff4b4e` from 2026-10-22. This does not establish production health, current environment values, database migration state, backup restore, or customer data correctness.
- Prior read-only Office-app observation: quotation send was blocked by placeholder Terms & Conditions; Service Report review screen described document-only approval requiring Super Admin. This is consistent with current source. No new live data was created or changed in this audit.

## Prioritized gaps and required action

| Priority | Gap | Impact | Recommended action / acceptance evidence |
|---|---|---|---|
| P0 | Render uses the failing OCR stub; database-backed upload-to-lock flow remains unverified | Uploaded report fields do not reach OCR staging in the current deployment; field extraction cannot be operationally proven there | Configure a real provider in an isolated non-production deployment and prove a fresh upload through extraction, verification, confirmation, and lock with E2E evidence. |
| P0 | No isolated local/staging E2E environment available | Role, data-integrity, concurrency, and cross-module behavior remain unproven | Provide a dedicated test DB and Redis, with non-production guardrails; run migration deploy and the complete API E2E suite against that environment only. |
| P1 | No integrated cross-module happy-path test | Separate module tests can pass while data mapping between Inquiry, Quote, Work Order, Technician, Report, and Dashboard is broken | Add one composed E2E that uses all roles and verifies linked record IDs, permissions, status transitions, audit events, and final dashboard entries. |
| P1 | Quotation sends blocked by placeholder commercial terms | Staff cannot complete customer-facing quotation flow | Owner supplies approved terms, payment wording, validity, warranty, and other contract language; test PDF content and send/accept workflow without placeholder markers. |
| P1 | Unsupported Next.js 14.2.35 dependency line | Security and support risk on both public frontends | Upgrade on a controlled branch to a supported patched release; rerun builds, UI tests, login, dynamic routes, upload, and deployment smoke checks. |
| P1 | Purchasing, inventory/material issue, billing/AR/collections, and project expense controls absent | No end-to-end purchasing or cash-control workflow; quoted cost is not actual profitability or collection | Prioritize lightweight purchasing/material issue and invoice/collection tracking after Owner confirms pilot scope. |
| P2 | No outbound notification/reminder service | Follow-ups and PM due dates depend on staff checking screens manually | Add notifications only after deciding email/SMS provider, recipients, and reminder policy. |
| P2 | Old architecture/status documentation conflicts with code | Auditors and operators can make incorrect assumptions | README now points to current modules and current audit; retain phase baselines as historical decisions, not claims of operational verification. |

## Owner decisions needed before implementation or pilot

1. Confirm whether service reports should use extracted-field verification, document-only approval, or both as selectable paths. Current Render configuration still uses the document-only `stub` path.
2. Supply legally and commercially approved quotation Terms & Conditions; placeholder text must remain blocked from customer sending.
3. Confirm the live Render deployment is staging/non-production before creating test business data there. Provide a dedicated Owner/Admin test login if Owner approvals must be tested through the UI.
4. Decide whether finance, purchasing/inventory, and technician timekeeping are required for the first pilot or may remain manual outside the ERP.

