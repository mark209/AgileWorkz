# AgileWorks HVAC ERP — Engineering Audit

**Audit date:** 2026-10-11  
**Branch:** `audit/system-improvements`  
**Scope:** Repository architecture, source code, dependency metadata/audit, local build/test checks, and available unauthenticated UI routes. No production services or business records were accessed.  
**Companion reports:** [DEPENDENCY_AUDIT.md](DEPENDENCY_AUDIT.md), [SECURITY_AUDIT.md](SECURITY_AUDIT.md), [UI_UX_AUDIT.md](UI_UX_AUDIT.md), [IMPROVEMENT_ROADMAP.md](IMPROVEMENT_ROADMAP.md).

## Executive summary

The application is a substantial, organized TypeScript monorepo, not a prototype requiring replacement. It has a NestJS API, two Next.js interfaces, a Prisma/PostgreSQL data layer, background OCR processing, shared types, permission enforcement, and meaningful automated tests. Core build, typecheck, lint, and unit/component suites pass in this local environment. Targeted hardening and operational verification are justified; a large architectural rewrite is not.

The main production concern is the installed Next.js 14.2.35 line in both apps: it is unsupported and appears in critical advisories. Additional actionable dependency advisories affect Joi, Multer and several transitive packages. The application also accepts the example JWT placeholder values under its current minimum-length validation. Both issues should be addressed before public production exposure. Other application-specific risks are conditional and documented with their evidence in the security report.

### Technology and project structure

| Area | Discovered implementation |
|---|---|
| Workspace/package manager | TypeScript monorepo, pnpm workspaces; six projects including root, API, office app, field app, shared types, and config. Lockfile is `pnpm-lock.yaml`; package manager version is not pinned in `package.json`. |
| API | NestJS 10, Express, class-validator, Joi environment validation, JWT authentication, Argon2 passwords, global throttling and permission guards. |
| Office UI | Next.js 14 App Router, React 18, Tailwind CSS, shared shadcn-style components. |
| Field UI | Next.js 14 App Router, React 18, touch-oriented technician job and service-report flows. |
| Database | PostgreSQL via Prisma 5.22; schema contains roughly 80 models, migrations and seed tooling. |
| Async/integrations | Redis and BullMQ; OCR queue/worker; local or S3-compatible object storage; Google GenAI integration with stub as the example default; React PDF. |
| Runtime | `engines.node` requires Node >=20. Local validation used Node 24.13.1 and pnpm 11.19.0. |

The repository separates `apps/api`, `apps/web`, `apps/field`, shared `packages`, database artifacts under `prisma`, and local infrastructure under `infra`. The root README and the Prisma schema header are stale: they describe Phase 1 as the only implemented phase, while current code/schema and `docs/architecture/rev7-blueprint-summary.md` contain later customer, quotation, work-order, service-report, OCR, and dashboard capabilities. Update those descriptions to match the current repository.

### Setup and local execution

- Repository cloned with Git history intact; the requested branch exists and is checked out. No remote push was performed.
- `.env.example` exists; no `.env` or real credentials were present. Local database, migration-role, JWT, and OCR worker database configuration are required. README documents local role/migration setup.
- Docker was unavailable. No database, Redis, storage service, production endpoint, or business transaction was used. No config values were fabricated.
- `pnpm install --frozen-lockfile` and `pnpm prisma:generate` succeeded. API development server compiled then stopped at startup validation for missing `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and `OCR_WORKER_DATABASE_URL`.
- Production builds passed for API, office app, and field app. Both unauthenticated `/login` routes returned HTTP 200 (`AgileWorks HVAC ERP` and `AgileWorks Field`). Authenticated routes were not exercised.
- More detail and limitations are recorded in **Verification results** below.

## Top 10 findings

| ID | Finding | Priority | Evidence/status |
|---|---|---:|---|
| SEC-001 / DEP-001 | Both frontends use unsupported Next.js 14.2.35 with critical advisories | P0 | Lockfile and registry audit verified; advisory exploit preconditions depend on production host/config. |
| SEC-003 | Example JWT placeholders meet production minimum-length validation | P1 | Environment schema and `.env.example` inspected; production misuse not observed. |
| DEP-004 | Direct Joi 17.13.4 has advisories; patch within 17.x is available | P1 | Registry audit verified; vulnerable Joi methods were not found in current schema usage. |
| DEP-006 | Multer 2.3.0 has an upload DoS advisory and workspace override | P1 | Advisory and version verified; disk-storage condition not observed in upload setup. |
| DEP-002 | Production `proxy-addr` transitive advisory | P1 conditional | Installed 2.0.7 verified; current app uses numeric trust-proxy hops, not the advisory's vulnerable subnet form. |
| SEC-004 | Customer document MIME validation trusts request header | P2 | Source comparison verified; no malicious upload performed. |
| SEC-006 | Stateless logout/deactivation does not revoke already-issued JWTs | P2 | Source and documented phase tradeoff verified; token theft not simulated. |
| UX-001 | Customer table navigation is mouse-only | P1 | Source review verified; browser keyboard check unavailable. |
| UX-002 | Customer list fetches all records and searches only locally | P2 | API/UI source verified; performance degradation not measured. |
| REL-001 | Customer document upload and audit write are not atomic/idempotent | P1 | Source path reviewed; database-backed failure/retry scenario unavailable. |

Severity labels distinguish confirmed code/configuration facts from conditional exploitability. Dependency advisories and source-level weaknesses do not prove a production incident or reachable exploit. Full evidence and remediation are in the companion reports.

## Architecture and code-quality assessment

The major boundaries are clear: Nest modules/services/controllers, a Prisma data layer, separately routed office and field apps, and shared type/config packages. Authentication and permission enforcement are applied centrally, with additional record-scope checks in work-order and service-report paths. The schema is large but consistent with the feature set visible in the code. No evidence supports replacing the current stack.

Maintainability concerns are manageable and localized: the two frontends use different styling construction patterns; some list endpoints return unbounded collections; dashboard reads are sequential; and root documentation has not kept pace with completed modules. No broad unused-code/dead-code conclusion was made from a full static dependency graph analysis. Lint produced only two warnings for unused parameters in one work-order e2e spec.

### REL-001 — Document upload can report failure after the document was saved

- **Severity / priority:** Moderate / P1 reliability follow-up.
- **Affected file:** `apps/api/src/modules/documents/documents.service.ts:67-114`.
- **Evidence:** The service writes the object, creates the database row, then calls `audit.write()` outside the row-creation `try/catch`. If the audit write fails, the request errors after the object and document row are already persisted. A client retry generates a new UUID and can create a second document/object.
- **Impact:** Staff may see an apparent failed upload even though the document is available, retry it, and leave duplicate records. The failed audit write also leaves a gap in the document event trail.
- **Recommendation:** Define expected behavior for audit-store failure and retry. Use an idempotency key for upload retries and an outbox/transactional audit mechanism or safe compensating behavior so an API failure maps clearly to persisted state.
- **Verification status:** Confirmed by source path; database-backed fault injection was unavailable because no local database was configured.

### Existing functionality worth retaining

- Customer/contact/site/asset records and their history.
- Inquiry and quotation lifecycle, revision structure, pricing and PDF-related functionality.
- Work orders, assignment/lifecycle controls, technician field app and service-report workflows.
- OCR upload/staging path and background processing architecture.
- Global authentication, permissions, throttling, DTO validation, Argon2, explicit CORS, and Helmet controls.
- Audit log append/query model and restricted SQL grants on audit records.
- Shared office loading, error and empty states; permission-gated actions; field upload feedback and timeout handling.

## Verification results

| Check | Result | Notes |
|---|---|---|
| Git/branch | Passed | Clone preserved history; branch is `audit/system-improvements`; no push. |
| Frozen dependency install | Passed | `pnpm install --frozen-lockfile`; native install scripts followed package-manager policy. |
| Prisma client generation | Passed | `pnpm prisma:generate`; initial generated-client type errors were resolved by generation, then validations rerun. |
| Typecheck | Passed | Root `pnpm typecheck`. |
| Lint | Passed with 2 warnings | Root `pnpm lint`; warnings are unused `quotationId` and `revisionId` in `apps/api/test/e2e/work-order-maintenance-generation.e2e-spec.ts:172`. |
| Production builds | Passed | Sequential workspace build for API, field, and office apps. |
| API unit/integration suite | Passed | 38 suites / 382 tests, `pnpm --filter @agileworks/api test --runInBand`. These are local test suites, not live database e2e evidence. |
| Field app tests | Passed | 6 files / 35 tests. |
| Office app tests | Passed | 19 files / 126 tests. |
| Dependency security audit | Findings | `pnpm audit --json`: 5 critical, 33 high, 37 moderate, 11 low across dependency paths. Reachability is assessed separately. |
| Local app smoke check | Partial pass | Login route returned HTTP 200 for both apps; visual/browser interaction unavailable. |
| API runtime with local services | Blocked by environment | Compiled, then required env validation failed because no local `.env`/services exist. |
| Database/e2e/migrations | Not run | Docker/database unavailable; no data was created or changed. |
| Visual/responsive/accessibility inspection | Not run | Browser automation runtime could not initialize; no seeded authenticated user. See UI audit. |
| License/complete transitive maintenance scan | Not fully assessed | No license scanner was available; package manager inventory and registry advisory checks were used. |

The first aggregate test invocation under concurrent install/build load timed out in frontend suites. Running the suites sequentially produced the passing counts above. This is not reported as a confirmed test defect.

## Missing setup/deployment evidence

- Provide a safe local development database and documented non-production seed account to validate authenticated workflows.
- Confirm production host OS, reverse-proxy topology, image optimization formats, object-storage policy, and environment-secret provisioning.
- Add or document CI checks for Node/pnpm versions, frozen install, typecheck, lint, tests, builds, Prisma migration validation, and dependency audit triage.
- Pin the package manager version and document environment variables by service without including real values.
- Refresh stale phase/status documentation in root README and Prisma schema comments.

## Recommended decision

Keep the architecture and complete a focused hardening sequence: patch critical framework/dependency advisories, reject example secrets in production, verify migrations and authorization with a non-production database, then fix upload/audit reliability and keyboard interaction. Add bounded list APIs and improve dashboard loading as the dataset/workflow needs warrant. Defer broad UI alignment until screenshot-based review with representative data. The prioritized implementation order and estimates are in [IMPROVEMENT_ROADMAP.md](IMPROVEMENT_ROADMAP.md).

## Post-setup local UI follow-up — 2026-10-12

Since the initial audit, the Supabase development database was migrated and seeded, the local API/web/field applications were started, and the user confirmed that the authenticated office UI and shared navigation are visible. The seed adds application roles and reference data but no business records. The main office routes (`/dashboard`, `/customers`, `/quotations`, `/work-orders`, `/service-reports`) returned HTTP 200. These are route-serving checks only; they do not demonstrate that authenticated API calls or business workflows succeed.

The browser automation runtime still fails to initialize, so the current signed-in screen could not be independently inspected or clicked through. Source review uncovered a workflow blocker that was not verifiable during the initial empty-environment audit: the customer UI has no site or contact creation controls, while quotation and standalone work-order creation require an existing site. See UX-006 in `UI_UX_AUDIT.md`. This is a targeted workflow gap; it does not justify an architectural redesign.
