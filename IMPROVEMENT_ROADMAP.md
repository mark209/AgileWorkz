# Improvement Roadmap

**Audit date:** 2026-10-11  
**Scope:** Evidence-based follow-up tasks from the repository audit. Estimates are relative engineering effort, not calendar commitments. No roadmap changes have been implemented.

## P0 — Critical

| ID / Task | Evidence and affected area | Difficulty | Business impact | Implementation risk | Dependencies / order | Verification |
|---|---|---:|---:|---|---|---|
| ROAD-001 / Move both frontends off unsupported Next.js 14 and patch the critical advisories (SEC-001, DEP-001) | `apps/web/package.json:22`, `apps/field/package.json:15`, lockfile; current 14.2.35 | High | High | High: major framework/React migration may affect routing, images, middleware and build behavior | First: choose supported patched target, then update both apps coherently before production exposure | Frozen install, typecheck, builds, unit tests, login/authenticated route tests, image/upload checks, deploy staging on actual host OS |
| ROAD-002 / Reject placeholder and weak JWT signing values in production (SEC-003) | `apps/api/src/config/env.validation.ts:10-12`, `.env.example` | Low | High | Low/Medium: could block misconfigured deployments as intended | Can run in parallel with ROAD-001; confirm deployment secret generation process | Add config tests proving example placeholders fail in production and valid generated keys pass |

## P1 — High

| ID / Task | Evidence and affected area | Difficulty | Business impact | Implementation risk | Dependencies / order | Verification |
|---|---|---:|---:|---|---|---|
| ROAD-003 / Patch direct and transitive production advisories (DEP-002, DEP-004, DEP-005, DEP-006) | `apps/api/package.json`, `pnpm-workspace.yaml`, lockfile; Joi, Multer, lodash, proxy-addr | Medium | High | Medium: lockfile overrides can conflict with upstream ranges or upload behavior | After or alongside framework patch; small isolated package changes, not bulk upgrades | Audit JSON after lockfile update, frozen install, API tests, proxy and upload regression tests |
| ROAD-004 / Make document upload persistence and audit recording retry-safe (REL-001) | `apps/api/src/modules/documents/documents.service.ts:34-57,97` | Medium | High | Medium: object storage and SQL transaction coordination needs compensating cleanup/idempotency design | Before relying on document uploads in production; confirm expected duplicate semantics | Fault-inject audit/storage/database failures in local integration tests; retry same request and verify one object/row/audit event |
| ROAD-005 / Make customer list navigation keyboard accessible (UX-001) | `apps/web/src/app/customers/page.tsx:113-119` | Low | Medium | Low | Independent quick fix | Keyboard-only navigate/open customer; verify semantics and focus styling |
| ROAD-006 / Verify core authorization and workflow flows against a non-production database | `apps/api/src/app.module.ts`, scoped checks in work-order/service-report services; current e2e suite not run against configured DB | Medium | High | Medium: requires safe fixtures and migration setup | Requires local/staging database and demo users; do before release | Test role denial, record ownership, customer/quotation/work-order/service-report transitions and data persistence using non-production records |

## P2 — Medium

| ID / Task | Evidence and affected area | Difficulty | Business impact | Implementation risk | Dependencies / order | Verification |
|---|---|---:|---:|---|---|---|
| ROAD-007 / Add bounded server-side pagination and search/filter support to growing record lists (UX-002) | `apps/api/src/modules/customers/customers.service.ts:24`; quotation/work-order/service-report list methods; customer page search | Medium/High | High as data grows | Medium: API contracts and client pages change; avoid changing current filters unexpectedly | Set page-size/cursor convention first; prioritize customers and active work orders with the owner | API limit/bounds tests, stable sort tests, UI empty/loading/page tests; compare query shape on realistic data |
| ROAD-008 / Load independent dashboard sections concurrently (UX-003) | `apps/web/src/app/dashboard/page.tsx:68-107` | Low/Medium | Medium | Low/Medium: retain per-section error and permission behavior | Independent; can precede pagination | Unit test partial failures and verify all permitted sections render without waiting serially |
| ROAD-009 / Decide and implement token revocation policy (SEC-006) | `apps/api/src/modules/identity/auth.service.ts:80-114,132-141`, `jwt.strategy.ts:9-22` | Medium/High | Medium/High, based on business risk | Medium: changes session semantics and may add database/cache state | Owner/security decision on immediate revocation requirement; if required, use refresh rotation/revocation or session version | Tests for logout, refresh replay, disabled users, expired/revoked access token |
| ROAD-010 / Validate file signatures on customer documents (SEC-004) | `apps/api/src/modules/documents/documents.service.ts:46-57`; reuse service-report signature-check pattern | Low/Medium | Medium | Low/Medium: accepted formats and legitimate file variants must be confirmed | Confirm supported document types and storage policy | Test valid files, mismatched MIME/content, malformed files, size limits |
| ROAD-011 / Complete screenshot-based responsive and accessibility review (UX-005) | Office and field routes; currently only unauthenticated login checked | Medium | Medium | Low | Needs seeded non-production users/data and browser automation | Inspect desktop/tablet/mobile, keyboard/focus, contrast, dialogs, forms, tables, and core role-based workflows; record screenshots/findings |
| ROAD-012 / Clarify local Compose service exposure and credentials (SEC-005) | `infra/docker-compose.yml:4-40` | Low | Medium | Low | Before any shared-network use; confirm Compose is development-only | Bind development ports to loopback or require local secret env; test startup from documented setup |

## P3 — Low

| ID / Task | Evidence and affected area | Difficulty | Business impact | Implementation risk | Dependencies / order | Verification |
|---|---|---:|---:|---|---|---|
| ROAD-013 / Align shared interaction tokens/patterns between office and field without forcing a redesign (UX-004) | `apps/field/src/lib/styles.ts`; `apps/web/src/components/ui`, `globals.css` | Medium | Low/Medium | Low/Medium: avoid harming field touch-first density | After ROAD-011 establishes visual evidence and employee feedback | Compare key states/screens and verify field touch targets and office consistency |
| ROAD-014 / Update stale phase/status documentation and pin pnpm | `README.md`, `prisma/schema.prisma` header, root `package.json` | Low | Medium | Low | Quick win; can be done with setup documentation | Verify README matches current routes/schema and pinned package manager reproduces frozen install |
| ROAD-015 / Add CI workflow for reproducible checks | No CI workflow found; package scripts already expose checks | Medium | Medium | Low/Medium: CI runtime/version may differ from local setup | After choosing/pinning Node and pnpm versions; use ROAD-014 | CI runs frozen install, Prisma generate, typecheck, lint, tests and builds; optionally non-production migration check and audit reporting |

## Quick wins

1. **ROAD-002:** fail startup when production JWT values are known placeholders; low effort and directly addresses a deployment footgun.
2. **ROAD-005:** replace mouse-only row navigation with a semantic link and visible focus state.
3. **ROAD-008:** parallelize independent dashboard reads while preserving partial-error behavior.
4. **ROAD-014:** correct stale README/schema descriptions and pin pnpm for reproducible setup.
5. **ROAD-012:** bind development-only service ports to localhost if the stack is intended only for one-machine use.

## Suggested sequence

1. Establish production deployment details and safe non-production database/seed access.
2. Patch the unsupported Next.js line and dependency advisories (ROAD-001, ROAD-003); do not apply blanket latest-version upgrades.
3. Reject placeholder signing keys and validate deployment secret provisioning (ROAD-002).
4. Exercise permissions and critical CRUD/workflow transitions using non-production fixtures (ROAD-006), then address upload retry/transaction behavior (ROAD-004) and file signature checks (ROAD-010).
5. Deliver the keyboard navigation fix and dashboard read improvement (ROAD-005, ROAD-008); plan bounded pagination based on current record volumes and employee priorities (ROAD-007).
6. Complete visual review with authenticated sample records (ROAD-011), then decide whether targeted design-system alignment provides value (ROAD-013).
7. Update docs, package-manager pin, and CI (ROAD-014, ROAD-015). Schedule token revocation work (ROAD-009) according to the owner's session-security requirement.

## Scope and decision notes

- **Retain:** existing customer, quotation/revision, work-order, technician service-report, OCR staging, permission, and audit-log capabilities. The tests and schema show meaningful implementation that should be protected during upgrades.
- **Refactor level:** targeted changes are justified. No evidence supports a larger architecture redesign or rewrite.
- **Business features:** do not add reminders, notifications, analytics, or broader CRM flows until employees confirm a concrete workflow gap. Server-side search/filtering is the clearest supported candidate because current list behavior is unbounded.
- **Risk boundary:** all verification should use local/staging services and synthetic records until the owner explicitly authorizes any production activity. No remote push or deployment is part of this roadmap.

## Post-setup follow-up task — 2026-10-12

| ID / Task | Evidence and affected area | Difficulty | Business impact | Implementation risk | Dependencies / order | Verification |
|---|---|---:|---:|---|---|---|
| ROAD-016 / Complete customer setup in the office UI with site and contact creation (UX-006) | `apps/web/src/app/customers/[id]/page.tsx:138-224`; quotation/work-order forms require a site | Medium | High | Medium: confirm existing API contracts, permissions, required fields, and whether edit flows are in scope | Before relying on new customer onboarding, quotation creation, or standalone work-order creation | Using synthetic records, create a customer, site, and contact; confirm the site is selectable in quotation/work-order forms and permission-denied roles cannot create them |
| ROAD-017 / Add a permission-gated customer profile edit flow (UX-010) | `apps/web/src/app/customers/[id]/page.tsx:100-137`; create-only customer dialog | Medium | High | Medium: preserve status lifecycle rules and confirm editable fields/API support | Alongside or after ROAD-016 customer setup work | Edit customer fields with a synthetic record; verify validation, update permission denial, reload persistence, and status transitions |
