# Production Security Readiness Review (READ-ONLY)

**Status: REVIEW ONLY. No application code, schema, migration, configuration,
infrastructure, dependency, or test file was modified to produce this
document.** Scope: the full codebase as it exists after F7.1 (commit
`1156b24`). This document does not declare the system "secure," "production
ready," or "safe" — it inventories what was found, how confident that
finding is, and what it actually blocks.

## How findings are classified

- **Severity**: Critical / High / Medium / Low
- **Type**: Confirmed exploitable vulnerability / Configuration-dependent
  risk / Hardening recommendation / Operational readiness gap

A "Configuration-dependent risk" means the code path exists and would be
exploitable under a specific deployment condition, but that condition is
not confirmed present today (e.g., Redis has no auth, but nothing in this
repo currently exposes Redis beyond localhost). Findings where I verified
the architecture does **not** actually expose the theoretical risk are
listed in the "Reviewed — no exploitable issue found" appendix at the end,
not scored as findings.

---

## A. Authentication, sessions, tokens, revocation

### F-A1 — No server-side session/token revocation on logout or account deactivation
- **Component**: `apps/api/src/modules/identity/jwt.strategy.ts`, `auth.service.ts`
- **Evidence**: `JwtStrategy.validate()` only verifies the JWT signature/expiry and returns `{ userId: payload.sub }` — it never queries `User.status`. `logout()`'s own code comment: *"Phase 1 issues stateless JWTs with no server-side refresh-token store, so 'logout' has nothing to revoke server-side yet."*
- **Scenario**: An Admin deactivates/suspends a user (e.g., a departing technician, a compromised account). That user's already-issued access token (≤15 min TTL) and refresh token (≤7 days TTL, if not separately blocked) remain fully valid until natural expiry — `refresh()` does re-check `status === ACTIVE` so a NEW access token can't be minted, but the CURRENT one keeps working for up to 15 more minutes.
- **Existing mitigation**: Short access-token TTL (15 min) bounds the window. Permissions are re-resolved fresh per request (a *role/permission* change takes effect immediately), so this gap is specifically about the *account-disabled* case, not a broader stale-permission issue.
- **Remediation**: A `User.sessionsInvalidatedAt` timestamp checked in `JwtStrategy.validate()` against the token's `iat`, bumped on deactivate/suspend/explicit logout (already scoped as F1.1 in the Phase 7 plan).
- **Severity**: Medium. **Type**: Hardening recommendation (requires the attacker to already hold a validly-issued token from a now-revoked account — a real but time-bounded window, not an open bypass).
- **Blocks private pilot**: No (small trusted user base, 15-minute window). **Blocks public production**: Recommended before, not strictly a hard blocker if pilot data proves low-risk.

### F-A2 — No refresh-token rotation or reuse detection
- **Component**: `auth.service.ts:87-101` (`refresh()`)
- **Evidence**: The same refresh token can be replayed repeatedly until its 7-day expiry; a successful `refresh()` call doesn't invalidate the token that was just used.
- **Scenario**: A leaked refresh token (e.g., from a compromised device) remains usable by an attacker for up to 7 days with no way for the legitimate system to detect or block the reuse.
- **Remediation**: Track issued refresh tokens (or their hash) with single-use/rotation semantics.
- **Severity**: Low-Medium. **Type**: Hardening recommendation.
- **Blocks private pilot**: No. **Blocks public production**: Recommended, not a hard blocker given the 7-day exposure is bounded and refresh tokens never leave the browser's memory (not persisted) in this app's current architecture.

### F-A3 — `PermissionsGuard` fails OPEN when no `@Permissions()` decorator is present
- **Component**: `apps/api/src/common/guards/permissions.guard.ts:29-31`
- **Evidence**: `if (!required || required.length === 0) { return true; }` — any route lacking a `@Permissions()` decorator (at method or class level) is allowed through with **zero** permission check.
- **Scenario**: A future endpoint added without remembering the decorator would be silently open to any authenticated user.
- **Investigation performed**: I systematically checked every route in every controller for a missing decorator. Two apparent gaps (`GET /roles/permissions`, `POST/DELETE /roles/:roleId/permissions/:id`) are actually covered by a **class-level** `@Permissions({module:"roles",action:"manage"})` on `RolesController`, which `getAllAndOverride` correctly applies. `GET /users/me` and `GET /system-settings` are similarly covered (self-scoped by `req.user.userId`, and class-level `system_settings.manage` respectively). **I found zero live instances of an unintentionally-open route today.**
- **Remediation**: Consider flipping the guard's default to fail-closed (deny unless explicitly marked `@Public()`), which would also require auditing every route once to add explicit decorators — a larger, deliberate change, not a quick patch.
- **Severity**: Medium (structural risk to future code, not a live gap). **Type**: Hardening recommendation.
- **Blocks private pilot**: No. **Blocks public production**: Recommended as process/lint discipline, not a hard blocker given zero live instances found.

### F-A4 — No account lockout after repeated failed logins
- **Component**: `auth.service.ts` (`login()`), `auth.controller.ts:18` (`@Throttle({limit:10, ttl:60_000})`)
- **Evidence**: Only rate limiting exists (10 attempts/min/IP on `/auth/login`); no per-account lockout counter.
- **Scenario**: A patient attacker with many source IPs (or a very long timeline) can still eventually brute-force a weak password — rate limiting slows, doesn't stop.
- **Severity**: Low-Medium. **Type**: Hardening recommendation. **Blocks private pilot**: No. **Blocks public production**: Recommended.

### F-A5 — Rate limiter uses in-memory storage
- **Component**: `app.module.ts:40` (`ThrottlerModule.forRoot`, no storage adapter configured)
- **Evidence**: No Redis-backed `ThrottlerStorage` — correct for one instance, but each horizontally-scaled instance would track its own counters, diluting the real limit.
- **Severity**: Low today, Medium once scaled. **Type**: Configuration-dependent risk. **Blocks private/public**: No (single-instance today).

---

## B. Authorization, RBAC, object-level access (IDOR)

### Findings
**None confirmed exploitable.** This was the most rigorously checked category given your explicit request. Summary of what was verified:

- Every module without a "my own records only" concept (Customers, Contacts, Sites, Assets, Equipment Systems, Quotations, Customer Documents) is gated on a flat module permission with **no** owner-scoping — this is the correct, intended design for a single-tenant internal ERP (confirmed against the blueprint: one company, no multi-tenant customer isolation is a stated requirement). This is not IDOR; there is no "owner" these records are supposed to be private to.
- The two resource types that *do* have a real ownership concept — Work Orders (`work_orders.read` vs `read_own`) and Service Reports (`service_reports.read` vs `read_own`) — use `getForActor(id, actor)`, which resolves the caller's *effective* permissions and independently verifies:
  - Work Orders: `read_own` only succeeds if the caller has an **active** (`unassignedAt: null`) assignment row on that specific Work Order.
  - Service Reports: `read_own` only succeeds if the caller is the report's own `uploadedBy`.
  - Neither permission → `ForbiddenException`, regardless of how the id was obtained (sequential, guessed, or leaked).
- This is **proven by existing, currently-passing tests**, not just code inspection: `"read_own rejects a caller who is not the uploader — never bypassable by knowing the id"` and the equivalent Work Order test both pass.
- Signed document URLs (`GET /documents/:id/signed-url`, the verification workflow's `documentUrl`) are only ever issued after the same permission-gated entity lookup — there is no route that hands out a storage URL without first checking access to the owning record.
- Storage keys themselves are non-guessable (`crypto.randomUUID()` + extension only), so even if the signed-URL *issuance* endpoint were somehow bypassed, an attacker still couldn't construct a valid signed URL for an arbitrary key without the HMAC secret.

**Conclusion on your specific questions**: No endpoint was found that bypasses RBAC. A technician cannot access another technician's Work Order or Service Report through any tested or inspected path. Document/storage keys do not expose files by guessing. Service Report/OCR lifecycle transitions all require their documented permission (see the frozen Phase 4 baseline's RBAC matrix, re-verified here) — none can be triggered by an unauthorized caller.

---

## C. CORS / CSRF

### F-C1 — No boot-time guard against an overly permissive CORS origin in production
- **Component**: `config/env.validation.ts`
- **Evidence**: `WEB_APP_ORIGIN`/`FIELD_APP_ORIGIN` have safe localhost defaults and the current `.env` values are specific, non-wildcard origins — but nothing would reject a wildcard or overly broad value if production `.env` were ever misconfigured.
- **Severity**: Low. **Type**: Hardening recommendation (cheap insurance against a future misconfiguration, not a live gap — current config is correct).

### CSRF — not applicable given this architecture
**Evidence**: Both frontends hold access tokens in memory only (confirmed: no cookies, no `localStorage`/`sessionStorage` for the token itself) and send them via an explicit `Authorization: Bearer` header that JS must construct — never an ambient credential a browser attaches automatically to a cross-origin request. CSRF fundamentally requires such an ambient credential (typically a cookie). **This is confirmed by architecture, not merely "no CSRF token exists."** No finding.

---

## D. File upload / Service Report / document security

### F-D1 — No magic-byte / content-signature verification of uploaded files
- **Component**: `service-reports.service.ts:114-121`, `documents.service.ts` (equivalent check)
- **Evidence**: `ALLOWED_UPLOAD_MIME_TYPES.has(file.mimetype)` checks only the client-supplied `Content-Type` header, never the actual file bytes.
- **Scenario**: A file with real content X but a spoofed header claiming an allowed type (pdf/jpeg/png/webp) would pass. Blast radius is narrow — the allowlist itself excludes script-executing formats (no SVG/HTML/JS), and served files have no `Content-Disposition` override, but no format in the allowlist is known to execute in a modern browser when served as its claimed type.
- **Status vs. your pre-pilot interim requirement**: You asked for "strict MIME/type allowlisting, file-size limits, filename/key safety, and server-side validation" as the pre-pilot substitute for malware scanning. **Three of four are already in place and verified**: the MIME allowlist is enforced server-side (not just client-side), `MAX_UPLOAD_BYTES` (25MB) is enforced at the Multer stream level (not post-hoc), and storage-key/filename handling is safe (`crypto.randomUUID()` + extension-only, plus `resolveSafe()`'s independent path-traversal re-check on local disk). **The one gap remaining is real content-signature (magic-byte) verification** — "server-side validation" today means header-trust, not content-inspection.
- **Remediation**: Verify the buffer's actual signature against the claimed MIME type before accepting (e.g., the `file-type` package).
- **Severity**: Medium. **Type**: Hardening recommendation.
- **Blocks private pilot**: No (narrow allowlist bounds the practical risk). **Blocks public production**: Recommended.

### F-D2 — No malware/virus scanning
- Per your explicit classification: **Required before production, not a pilot blocker**, given the three interim mitigations above are in place. Unchanged status — carried forward from the Phase 7 plan (F4.3), not newly discovered.

### F-D3 — Multer 2.0.2 (installed) carries 4 High + 1 Moderate DoS advisories
- **Component**: `apps/api/package.json` (`"multer": "^2.0.2"`, resolved/locked at exactly `2.0.2`)
- **Evidence**: `pnpm audit` — GHSA-xf7r-hgr6-v32p, GHSA-v52c-386h-88mc, GHSA-5528-5vmv-3xc2, GHSA-72gw-mp4g-v24j (all High), GHSA-3p4h-7m6x-2hcm (Moderate). All fixed in `multer >= 2.2.0` — a **minor**, non-breaking version bump, not a major migration.
- **Scenario**: An *authenticated* user holding `service_reports.upload` or `customer_documents.upload` (which includes Technician) sends a deliberately malformed multipart payload (deeply nested field names, an aborted upload the library fails to clean up, etc.) to degrade or crash the API process for other users. This requires authentication — it is not a pre-auth/unauthenticated attack surface.
- **Existing mitigation**: `MAX_UPLOAD_BYTES` limits payload size; the global rate limiter (100 req/min) bounds repeat attempts from one source; RBAC means only holders of an upload permission can reach the vulnerable code path at all.
- **Remediation**: Upgrade `multer` to `>=2.2.0` (verify no breaking API changes for this app's narrow usage — `FileInterceptor` with `limits.fileSize` only).
- **Severity**: Medium-High (real, currently-installed, known-vulnerable version directly on the upload path; impact is availability/DoS, not data exposure). **Type**: Confirmed exploitable vulnerability (by an authenticated user).
- **Blocks private pilot**: No (small trusted user base, low likelihood of an insider deliberately DoS-ing their own pilot). **Blocks public production**: Yes — cheap fix, real known CVEs, directly reachable.

### F-D4 — Vertex AI credential handling is unvalidated and not yet live
- **Component**: `providers/vertex-gemini.provider.ts`, `env.validation.ts`
- **Evidence**: No explicit credential-loading code in this provider — it relies on the `@google/genai` SDK's implicit Application Default Credentials resolution. `.env.example`'s own comment confirms: *"This repo still has NO real Vertex AI credentials configured anywhere."* `EXTRACTION_PROVIDER` is `"stub"` in the current `.env`.
- **Status**: Not a live risk today (the stub provider is what actually runs). This is an operational readiness gate for *whenever* `EXTRACTION_PROVIDER=vertex-gemini` is first activated in any real environment — at that point, whatever credential file/secret-manager approach is chosen needs its own review (file permissions, rotation, least-privilege service account scope).
- **Severity**: N/A today. **Type**: Operational readiness gap. **Blocks private/public**: Only if/when Vertex AI is actually activated — not currently.

---

## E. F7.1 idempotency — abuse-case analysis

### F-E1 — Key reuse across genuinely different uploads silently discards the new file
- **Component**: `service-reports.service.ts` (`claimIdempotencyKey`, the `COMPLETED` branch)
- **Evidence**: A `COMPLETED` key match short-circuits to `return-existing` regardless of whether the CURRENT request's file/fields differ from the ORIGINAL request that completed that key. This is standard idempotency-key semantics industry-wide (Stripe et al. document the identical behavior), but it means a client that reuses an old key for a genuinely new document gets back the *old* report, and the new file is never even reaches `performUpload` — silently dropped, not stored, not processed.
- **Scenario**: A buggy or modified client resubmits with a stale key believing it's uploading a new document; the technician sees a "success" response describing an unrelated, older report.
- **Is this a security vulnerability?** No cross-user exposure, no privilege escalation — the returned data always belongs to the *same* uploader's own prior work (uniqueness is per-uploader). This is a **data-integrity/correctness risk**, not a breach.
- **Current mitigation**: `apps/field`'s actual client generates a fresh `crypto.randomUUID()` per logical attempt and only reuses it across a genuine retry of the *same* attempt — under the shipped client, this scenario doesn't occur in normal use. It requires a modified or buggy client to trigger.
- **Severity**: Medium (data-integrity, not security). **Type**: Hardening recommendation. **Blocks private/public**: No.

### F-E2 — Cross-user key collision: confirmed not possible
Verified by both code inspection (`@@unique([uploaded_by, idempotency_key])`) and a passing e2e test using the *identical* key string from two different technicians — both succeed independently with no collision. No finding.

### F-E3 — Unbounded/oversized Idempotency-Key header has no application-level length check
- **Component**: `customers.controller.ts` (`@Headers("idempotency-key")`), `prisma/schema.prisma` (`idempotency_key @db.VarChar(100)`)
- **Evidence**: No `class-validator`-style length check exists on the header value before it reaches the DB. Postgres `VARCHAR(100)` rejects (doesn't silently truncate) an overlong value, which propagates as an unhandled Prisma error → `AllExceptionsFilter`'s generic path → a `500`, not a clean `400`.
- **Scenario**: A client sending an extremely long header value gets a confusing `500` instead of a clear validation error. Node's own default HTTP header-size cap (~8-16KB) bounds the absolute worst case; the global rate limiter bounds repeat attempts. No crash, no injection, no resource exhaustion beyond what any oversized-header request would already cause.
- **Severity**: Low. **Type**: Hardening recommendation (add an explicit length check for a clean `400`). **Blocks private/public**: No.

### F-E4 — Stale `IN_PROGRESS` claims are never automatically recovered
- **Component**: `service-reports.service.ts` (`claimIdempotencyKey`, `upload()`'s try/catch)
- **Evidence**: The `FAILED` path is only reached via the `upload()` method's own `catch` block. If the Node process crashes, is OOM-killed, or is restarted (e.g., a deploy) *between* successfully claiming a key (`IN_PROGRESS`) and either completing or failing, **nothing ever transitions that row out of `IN_PROGRESS`**. There is no time-based staleness check.
- **Scenario**: That specific `(uploader, key)` pair is permanently stuck — every future retry with the same key gets `409 Conflict` forever, with no automatic recovery. Requires manual DB intervention (`UPDATE ... SET status = 'FAILED' WHERE id = ...`) to clear.
- **Is this attacker-triggerable?** Not directly by a malicious *client* action alone — a client disconnecting doesn't stop server-side processing mid-transaction. It requires an actual server-side crash/restart, which is an operational event, not something a request alone can force in this codebase (no code path here allows a request to crash the process). This bounds it to an **operational resilience** issue rather than a direct attack vector, though a crash-inducing bug elsewhere in the process could compound with this to create a repeatable denial for a specific user.
- **Remediation**: A staleness check (e.g., treat `IN_PROGRESS` older than N minutes as eligible for re-claim, same guarded-`updateMany` pattern already used for `FAILED`).
- **Severity**: Medium. **Type**: Hardening recommendation / Operational readiness gap. **Blocks private pilot**: No (low likelihood in a short, monitored pilot; document the manual-recovery step as a runbook item). **Blocks public production**: Recommended before, given deploys/restarts are a normal production occurrence, not an edge case.

### F-E5 — Information leakage via retry response: confirmed not possible
The `return-existing` path is only reachable when `uploadedBy` matches the *caller's own* JWT-derived `userId` — never client-suppliable. No finding.

---

## F. Injection, XSS, SSRF — reviewed, no exploitable issue found

- **SQL/Prisma injection**: The only two raw-SQL call sites (`numbering.service.ts`, `health.controller.ts`) both use Prisma's tagged-template `$queryRaw` (auto-parameterized), never `$queryRawUnsafe` with string concatenation. Every other data access goes through Prisma's query builder. No injection surface found.
- **Command injection**: No `child_process`/`exec`/`spawn` usage anywhere in `apps/api/src`. No shell-out surface exists.
- **XSS**: No `dangerouslySetInnerHTML` or direct `innerHTML` assignment anywhere in `apps/web` or `apps/field`. All dynamic content renders through JSX's default escaping.
- **SSRF**: No backend endpoint accepts a client-supplied URL that the server then fetches. The one URL-shaped value returned to a client (`documentUrl`) is server-generated (a signed URL derived from an internal storage key), never a client-supplied destination the server visits.

---

## G. Logging, audit trail, error handling

- **`AllExceptionsFilter`**: Confirmed (re-verified) to never leak stack traces or raw internal error messages for unexpected `Error`s — only deliberately-thrown `HttpException`s (validation messages, intentionally safe) pass through verbatim. No finding.
- **Audit coverage**: Spot-checked across Work Orders, Assignments, Quotations, Service Reports, Documents, Customers, Contacts, Sites, Inquiries — every mutating method has a corresponding `AuditLog` write. No gap found.
- **Sensitive-data leakage**: `passwordHash` is only ever selected by `findByEmailWithSecrets`, called exclusively by `AuthService` for login verification, never returned in any API response or written to any audit log. Every other user query uses an explicit `USER_SAFE_SELECT` allowlist. JWTs carry only `{ sub: userId }` — no permissions/roles embedded. No finding.

### F-G1 — Health endpoint exposes raw component error text to unauthenticated callers
Carried forward unchanged from the Phase 7 plan (F1.3). `GET /health` is `@Public()` and returns `error: (e as Error).message` for DB/queue/storage failures. **Severity**: Low. **Type**: Hardening recommendation.

---

## H. Infrastructure: databases, queue, storage, containers, TLS

### F-H1 — Redis has no authentication configured anywhere
- **Evidence**: No `requirepass` in `infra/docker-compose.yml`, no credentialed `REDIS_URL` anywhere in `.env`/`.env.example`, no such env var even exists in `env.validation.ts`'s schema.
- **Scenario IF exposed**: Anyone who can reach port 6379 has full read/write/flush access to the BullMQ extraction queue (job data includes storage keys and Service Report ids) and the rate-limiter's own state, with zero credentials.
- **Current exposure status**: `docker-compose.yml` is explicitly a local-dev file; nothing in this repo indicates it is deployed to a network-reachable host today.
- **Severity**: **Critical if ever network-exposed; not confirmed exposed today.** **Type**: Configuration-dependent risk.
- **Blocks private pilot**: Yes, IF the pilot runs on any shared/cloud host rather than a developer's own machine (a small private pilot is very often deployed to *some* server) — add a Redis password and bind to localhost/private-network-only before that happens. **Blocks public production**: Yes, unconditionally.

### F-H2 — Docker-compose default credentials (Postgres superuser, MinIO) and unscoped port bindings
- **Evidence**: `infra/docker-compose.yml` — `POSTGRES_PASSWORD: postgres` (the actual `postgres` superuser, distinct from the app's own custom `app_runtime`/`app_migrator` roles which DO have real passwords), `MINIO_ROOT_USER/PASSWORD: minioadmin/minioadmin`. All three services (`5432`, `6379`, `9000/9001`) are published via `"host:container"` port syntax with no explicit bind address, which — depending on host OS/firewall — can expose them beyond localhost.
- **Same nuance as F-H1**: Critical if exposed, not confirmed exposed today (dev-only intent).
- **Severity**: Critical if exposed / Low as-is today. **Type**: Configuration-dependent risk.
- **Blocks private pilot**: Yes, if this exact compose file is what gets deployed for the pilot rather than a properly credentialed environment. **Blocks public production**: Yes, unconditionally — change every default credential and bind admin ports to localhost/private network only.

### F-H3 — No Dockerfile / containerized production build exists for any of the three apps
- **Evidence**: Repo-wide search found zero `Dockerfile`s.
- **Severity**: N/A (absence of a capability, not a vulnerability). **Type**: Operational readiness gap.
- **Blocks private pilot**: Not strictly (can run via `pnpm start`/`next start` directly on a host), but running Node processes directly on a host has its own hardening needs (process user, restart policy, log rotation) that are currently undocumented. **Blocks public production**: Yes — needed for any repeatable, reviewable deployment.

### F-H4 — No `trust proxy` configuration; `req.ip` would be wrong behind any reverse proxy/load balancer
- **Evidence**: No `app.set('trust proxy', ...)` or equivalent anywhere in `apps/api/src`.
- **Scenario**: If deployed behind a reverse proxy or load balancer (the standard, expected production pattern, and normal even for a pilot on a managed platform) without this configured, Express's `req.ip` reports the **proxy's** IP for every request. This breaks the accuracy of: (a) the login rate limiter (all traffic would share one bucket, keyed to the proxy, meaning one bad actor could lock out every real user — a self-inflicted denial of service), and (b) every audit log entry's recorded IP (forensic value lost).
- **Severity**: Medium. **Type**: Configuration-dependent risk (only manifests once actually proxied).
- **Blocks private pilot**: Recommended before, if a reverse proxy is used (likely). **Blocks public production**: Yes.

### F-H5 — No TLS termination in the application; no reverse-proxy/TLS plan exists in this repo
- **Evidence**: `main.ts` calls `app.listen(port)` over plain HTTP; no certificate/HTTPS configuration exists anywhere. This is a normal, correct pattern for an app that expects a proxy to terminate TLS — but no such proxy configuration (nginx, Caddy, cloud load-balancer IaC) exists in this repo to confirm the plan is real.
- **Severity**: N/A (architecture is TLS-agnostic by design). **Type**: Operational readiness gap.
- **Blocks private pilot**: Yes — credentials and Bearer tokens must never travel over plaintext HTTP, even for a small trusted pilot. **Blocks public production**: Yes, unconditionally.

### F-H6 — `apps/web`/`apps/field` ship with no security headers of their own
- **Evidence**: `helmet()` is only registered in `apps/api/src/main.ts` — it has no effect on responses served by the two Next.js apps. Neither `next.config.js` configures a `headers()` function (no CSP, no `X-Frame-Options`, no HSTS at the frontend layer).
- **Severity**: Medium. **Type**: Hardening recommendation (mitigated somewhat by the narrow, controlled nature of these apps and the absence of XSS sinks found in section F, but still a missing defense-in-depth layer, e.g. against clickjacking).
- **Blocks private pilot**: No. **Blocks public production**: Recommended.

### F-H7 — Local-disk storage's HMAC signing secret reuses `JWT_ACCESS_SECRET`, with a hardcoded fallback string
- **Evidence**: `local-disk-storage.provider.ts:23` — `this.secret = process.env.JWT_ACCESS_SECRET ?? "dev-only-local-storage-secret"`.
- **Scenario**: Two unrelated security purposes (JWT signing, storage-URL signing) share one secret, coupling their rotation and widening the blast radius of a single leak. The hardcoded fallback is a real string in source, though `env.validation.ts`'s `Joi.string().min(16).required()` on `JWT_ACCESS_SECRET` means the app cannot boot without a real value today, making the fallback practically unreachable in the current architecture.
- **Severity**: Low-Medium. **Type**: Hardening recommendation (use a distinct, dedicated secret for storage-URL signing).
- **Blocks private/public**: No, given the fallback is currently unreachable.

### F-H8 — No backup/restore automation or tested restore procedure
Carried forward unchanged from the Phase 7 plan (F9.1). **Severity**: High. **Type**: Operational readiness gap. **Blocks private pilot**: Only if real, non-disposable data will be entered — recommended regardless. **Blocks public production**: Yes, unconditionally, including a *tested* restore, not just a documented one.

---

## I. Dependency vulnerabilities

`pnpm audit`: **0 critical, 18 high, 22 moderate, 6 low** across 1,168 total (dependencies + devDependencies).

- **Multer** (`apps/api`, runtime): see F-D3 above — the one dependency finding with a direct, currently-reachable, authenticated attack surface.
- **Next.js 14.2.35** (`apps/web`, `apps/field`, runtime): 21 advisories (8 high, 11 moderate, 2 low) fixed across versions up to 15.5.21 — all require a **major** version upgrade. I checked whether the specific vulnerable *features* (middleware, Server Actions, rewrites, i18n, `next/image` `remotePatterns`) are actually used anywhere in either app: **none of them are** (no `middleware.ts`, no `"use server"`, no `rewrites()`/`i18n` config, no remote image patterns configured). This meaningfully narrows practical exploitability today, though the underlying package version is still stale and should be tracked. **Severity**: Medium (dependency-currency, low practical exploitability given non-usage of affected features). **Type**: Hardening recommendation. **Blocks private/public**: Not immediately, but should be scheduled — a major-version migration is real effort and shouldn't be deferred indefinitely.
- **lodash `_.template` code injection** (transitive via `@nestjs/config`): not invoked by application code with attacker-controlled input anywhere found. **Severity**: Low. **Type**: Hardening recommendation.
- Remaining high/moderate/low findings are entirely in **devDependencies** (`@nestjs/cli`'s own transitive `glob`/`tmp`/`picomatch`/`inquirer` chain, ESLint tooling) — these run only in developer/CI environments, never in a deployed server or served to an end user. **No production exposure.**

---

## Checklist A — Minimum Safe for Private Pilot (small, trusted, controlled users)

- [ ] **F-H5**: TLS in front of the API and both frontends (even a pilot must not send credentials/tokens over plaintext HTTP).
- [ ] **F-H1 / F-H2**: If the pilot runs on any shared/cloud host (not literally a developer's own laptop) — set real Redis auth, real non-default Postgres/MinIO credentials, and bind admin ports (5432/6379/9000/9001) to localhost or a private network only.
- [ ] **F-D3**: Upgrade `multer` to `>=2.2.0` (cheap, minor-version fix, directly reachable by any authenticated uploader including Technician).
- [ ] Confirm the pre-pilot interim file-upload mitigations you already approved are in fact all live: MIME allowlist (✅ confirmed in place), file-size limit (✅ confirmed in place), filename/key safety (✅ confirmed in place) — the one gap is magic-byte content verification (F-D1), which is recommended but not a hard pilot blocker given the narrow allowlist.
- [ ] Decide on and document a basic backup step for whatever data the pilot actually enters, even if informal (F-H8) — full tested restore automation is a production requirement, not necessarily a pilot one, but *some* recovery plan should exist if real data is used.
- [ ] **F-H4**: Configure `trust proxy` if a reverse proxy/load balancer sits in front of the pilot deployment (very likely on any managed hosting).

## Checklist B — Minimum Safe for Public Production

Everything in Checklist A, plus:
- [ ] **F-A1**: Session/token revocation on deactivate and logout.
- [ ] **F-D2**: Malware/virus scanning on uploads (per your existing classification — required before production).
- [ ] **F-D1**: Magic-byte file content verification.
- [ ] **F-H8**: Backup automation with a *tested* restore drill, not just a documented procedure.
- [ ] **F-H3**: Real, repeatable containerized (or equivalent) deployment for all three apps.
- [ ] **F-H6**: Security headers on `apps/web`/`apps/field` (CSP at minimum, `X-Frame-Options`).
- [ ] **F-A4**: Account lockout after repeated failed logins.
- [ ] **F-A5**: Redis-backed rate-limit storage (once horizontally scaled).
- [ ] **F-A2**: Refresh-token rotation/reuse detection.
- [ ] **F-E4**: Stale `IN_PROGRESS` idempotency-claim recovery (or a documented, tested manual-recovery runbook step as an interim).
- [ ] Dependency currency: schedule the Next.js major-version upgrade; re-run `pnpm audit` as part of normal release hygiene.
- [ ] **F-G1**: Scrub the health endpoint's public error detail.
- [ ] **F-H7**: Use a dedicated secret for storage-URL HMAC signing, distinct from `JWT_ACCESS_SECRET`.
- [ ] **F-C1**: Boot-time guard against a misconfigured (wildcard/non-HTTPS) production CORS origin.
- [ ] **F-E3**: Explicit length validation on the `Idempotency-Key` header (clean `400` instead of a generic `500`).

---

## Prioritized remediation sequence

**P0 — must fix before private pilot**
1. F-H5 — TLS in front of every service
2. F-H1/F-H2 — real credentials + network isolation for Redis/Postgres/MinIO, *if* deploying beyond a developer's own machine
3. F-D3 — Multer upgrade to `>=2.2.0`
4. F-H4 — `trust proxy`, if a reverse proxy is in front of the pilot

**P1 — must fix before public production**
5. F-A1 — session/token revocation
6. F-D2 — malware scanning (per your prior classification)
7. F-D1 — magic-byte file verification
8. F-H8 — tested backup/restore
9. F-H3 — containerized deployment
10. F-H6 — frontend security headers
11. F-A4 — account lockout
12. F-A2 — refresh-token rotation
13. F-E4 — stale-claim recovery
14. F-G1 — health endpoint error scrubbing
15. F-H7 — dedicated storage-signing secret
16. F-C1 — CORS boot-time guard
17. F-E3 — Idempotency-Key length validation

**P2 — recommended after launch**
18. F-A3 — consider fail-closed `PermissionsGuard` default
19. F-A5 — Redis-backed rate limiting (once scaling is real)
20. Next.js major-version upgrade
21. F-E1 — consider documenting/guarding against idempotency-key misuse
22. F9.2 (from the Phase 7 plan) — retention-policy documentation (already deferred per your instruction)

---

## Cross-reference with the existing Phase 7 hardening plan

| Phase 7 plan item | Status after this review |
|---|---|
| F1.1 (session revocation) | Still valid, unresolved — restated here as F-A1 with fresh evidence |
| F1.2 (account lockout) | Still valid, unresolved — F-A4 |
| F1.3 (health endpoint leak) | Still valid, unresolved — F-G1 |
| F1.4 (in-memory rate limiter) | Still valid, unresolved — F-A5 |
| F1.5 (CORS boot guard) | Still valid, unresolved — F-C1 |
| F2.1 (query-param DTOs) | Still valid, unresolved — not re-detailed above (no new evidence beyond the original plan), still low-medium |
| F2.2 (S3 env validation) | Still valid, **reinforced** by this review — the S3 provider's `?? ""` credential fallback confirms a misconfigured deploy would fail silently at boot and only surface at first real S3 call |
| F3.1 (`completeVerification` hardening) | **Resolved** — implemented and tested this Wave |
| F4.1 (magic-byte check) | Still valid, unresolved — F-D1, with a precise status update on which of your pre-pilot interim requirements are already met |
| F4.3 (malware scanning) | Still valid, per your existing classification — F-D2 |
| F5.1 (OCR call timeout) | Still valid, unresolved — not re-detailed above (no new evidence) |
| F6.1/F6.2 (field timeout/form persistence) | **Resolved** — implemented this Wave |
| F7.1 (upload idempotency) | **Resolved** — implemented and reviewed; this review adds the abuse-case analysis (F-E1 through F-E5) you specifically asked for |
| F9.1 (backup/restore) | Still valid, unresolved — F-H8 |
| F9.2 (retention enforcement) | Deferred per your explicit instruction — unchanged |
| F10.1 (pagination) | Not re-reviewed this pass (not a security-classified item in your list) — still open per the plan |
| F11.1 (git) | **Resolved** — repository initialized this Wave |
| F11.2 (Dockerfiles) | Still valid, unresolved — F-H3 |
| F12.1 (CI) | **Resolved** — pipeline added this Wave (not yet run in a real GitHub Actions environment, as previously disclosed) |

**Newly discovered by this review, not in the original Phase 7 plan**:
- F-A3 (fail-open `PermissionsGuard` default — audited, zero live gaps found)
- F-D3 (Multer CVEs — concrete, actionable, directly relevant to uploads)
- F-D4 (Vertex AI credential-handling gate, not yet live)
- F-H1/F-H2 (Redis/Postgres/MinIO exposure specifics, with the exposed-vs-not-exposed nuance)
- F-H4 (`trust proxy`)
- F-H5 (explicit TLS/reverse-proxy gap statement)
- F-H6 (frontend security headers)
- F-H7 (HMAC secret reuse)
- F-E1 through F-E5 (the full F7.1 abuse-case analysis you specifically requested)
- Section I's full dependency audit (Next.js's 21 advisories, with the used-vs-unused-feature nuance)
- Section F's explicit injection/XSS/SSRF sweep (all confirmed clean)

---

## What this review does not claim

This document does not certify the system as secure, production-ready, or safe. It reflects a point-in-time, single-reviewer, code-and-configuration-level inspection — it is not a penetration test, does not include dynamic testing against a running deployment, and does not cover physical/personnel security, the eventual hosting provider's own security posture, or anything about how the pilot/production environment will actually be operated day to day.
