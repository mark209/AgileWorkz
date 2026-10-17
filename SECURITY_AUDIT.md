# Security Audit

**Audit date:** 2026-10-11  
**Scope:** Static review of the cloned repository and npm registry audit. No production endpoint, credentials, or business data were used.  
**Verification limit:** No database-backed authorization tests or external penetration tests were run because no `.env`, database, or Docker runtime was available.

## Findings

### SEC-001 — Unsupported Next.js 14 line has two critical RCE advisories

- **Severity / priority:** Critical / P0 before public exposure
- **Affected:** `apps/web/package.json:22`, `apps/field/package.json:15`; resolved version 14.2.35 in `pnpm-lock.yaml`
- **Evidence:** `pnpm audit --json` reports Next.js 14.2.35 in both production apps as affected by [GHSA-p293-qw3h-jr36](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36) (unauthenticated RCE on Windows-hosted Next servers using affected routers) and [GHSA-2xp9-vwfh-vxw4](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4) (RCE when AVIF is processed by the Image Optimization API). Next.js’s [support policy](https://nextjs.org/support-policy) lists 14.x as unsupported.
- **Problem and impact:** Both user-facing applications use the same vulnerable, unsupported framework line. Production host OS and image optimization use are unknown, so the two advisory preconditions have not been confirmed; the dependency finding itself is verified. If the relevant endpoint/configuration is exposed, impact includes server compromise.
- **Recommended remediation:** Move both apps to a currently supported patched line. At audit time the registry latest was 16.4.0; the advisories list 15.5.24 and 16.3.3 as minimum patch releases for those issues. Coordinate the Next and React upgrade, then test login, permissions, dynamic routes, uploads, and production build before deployment.
- **Verification status:** Verified dependency/advisory match; exploitability against a production deployment is not tested because no deployment configuration was present.

### SEC-002 — Critical `proxy-addr` advisory is present, but its trigger is not configured

- **Severity / priority:** Critical advisory / P1 conditional risk
- **Affected:** Transitive `proxy-addr` 2.0.7 via NestJS → Express; `apps/api/src/main.ts:32`, `apps/api/src/config/env.validation.ts:65`
- **Evidence:** [GHSA-jqcg-44mw-7w3h](https://github.com/jshttp/proxy-addr/security/advisories/GHSA-jqcg-44mw-7w3h) affects versions before 2.0.8 when a malformed IPv4-mapped IPv6 trust subnet is configured. The application currently sets Express trust proxy to a numeric hop count, not a subnet.
- **Problem and impact:** If the app or its deployment later switches to the affected subnet form, an attacker may spoof the client IP used by rate limiting and audit logs. This can undermine IP-based controls and evidence.
- **Recommended remediation:** Resolve `proxy-addr` to 2.0.8 or later and retain the existing validated numeric-hop configuration. Add proxy-hop tests using the actual reverse-proxy topology.
- **Verification status:** Advisory and dependency path verified; the vulnerable subnet condition was not found in the checked-in application configuration, so current exploitability is not confirmed.

### SEC-003 — Production secret validation accepts the committed example placeholders

- **Severity / priority:** High / P1 deployment blocker
- **Affected:** `apps/api/src/config/env.validation.ts:10-12`, `.env.example`
- **Evidence:** JWT access and refresh secrets are validated only as strings of at least 16 characters. The example values are explicit `CHANGE_ME...` placeholders and meet that length. The README tells operators to replace them, but the application does not distinguish placeholders from real secrets.
- **Problem and impact:** A deployment that copies the example file without replacing both values can start with public, predictable signing keys. A known key allows forged JWTs and can defeat authentication.
- **Recommended remediation:** Reject known placeholders and require high-entropy, independently generated values in production. Keep development setup explicit and add a startup validation test that proves placeholder secrets fail in `NODE_ENV=production`.
- **Verification status:** Validation rule and example values inspected; no secret values were copied into this report. Production exploit was not attempted.

### SEC-004 — Customer document uploads trust the client MIME header

- **Severity / priority:** Moderate / P2
- **Affected:** `apps/api/src/modules/documents/documents.service.ts:46-57`; comparator: `apps/api/src/modules/service-reports/service-reports.service.ts` uses `matchesFileSignature`
- **Evidence:** Document upload accepts a narrow MIME allowlist, but checks only `file.mimetype`, a caller-supplied multipart header. Service Report uploads additionally compare the bytes to the claimed MIME type; customer documents do not.
- **Problem and impact:** A client can label arbitrary bytes as PDF/JPEG/PNG/WebP and have them stored as an approved business document. This weakens file integrity and can expose downstream viewers or processors to malformed/polyglot content. No code path that executes uploaded files was identified.
- **Recommended remediation:** Apply the existing signature check to customer-document uploads, validate a safe extension policy, and preserve the upload size limit. Add tests for mismatched MIME and content.
- **Verification status:** Confirmed by code comparison; no malicious upload was sent.

### SEC-005 — Local Compose services use known credentials and publish ports broadly

- **Severity / priority:** Moderate / P2; deployment-specific
- **Affected:** `infra/docker-compose.yml:4-40`
- **Evidence:** Compose uses local PostgreSQL and MinIO default credentials, exposes PostgreSQL/Redis/MinIO ports without an explicit loopback bind, and configures Redis without authentication. The example file and comments describe these as development settings; `.env.example` explicitly warns that production Redis must use authentication/TLS.
- **Problem and impact:** Running this development stack on a shared/network-accessible machine can expose databases and object storage with known local credentials, with Redis unauthenticated. No evidence was found that this compose file is used in production.
- **Recommended remediation:** Bind development ports to `127.0.0.1`, keep the compose file clearly development-only, and require environment-provided credentials/TLS for any shared or deployed environment. Do not deploy these defaults.
- **Verification status:** Configuration verified; reachability from another host was not tested.

### SEC-006 — Logout and account disable do not immediately revoke access JWTs

- **Severity / priority:** Moderate / P2
- **Affected:** `apps/api/src/modules/identity/auth.service.ts:80-114, 132-141`; `apps/api/src/modules/identity/jwt.strategy.ts:9-22`; both frontend `auth-context.tsx` files
- **Evidence:** Tokens are stateless; logout writes an audit event and the client clears in-memory state. Access tokens last 15 minutes by default and refresh tokens 7 days. The JWT strategy trusts the signed subject without looking up current user status. The frontends currently keep only the access token in memory and discard the refresh token returned at login.
- **Problem and impact:** A copied access token remains usable until expiry after logout or user deactivation. A copied refresh token remains valid until its expiry because there is no server-side refresh-token store or revocation mechanism. The current clients’ memory-only policy reduces persistence but does not revoke a token already copied by an attacker.
- **Recommended remediation:** If immediate revocation is a business/security requirement, add server-side refresh-token rotation/revocation and check active-user status for access requests (or use a short-lived token denylist/session version). Preserve the current in-memory browser storage approach unless session persistence is deliberately designed.
- **Verification status:** Confirmed from implementation and explicitly documented as a stateless Phase 1 trade-off; no token theft scenario was tested.

## Controls observed

- Global rate limiting, global JWT authentication, and global permission checks are wired in `apps/api/src/app.module.ts`; login/refresh have tighter limits.
- Passwords are verified with Argon2; login error messages are generic.
- DTO validation rejects unlisted properties; Helmet and explicit CORS origins are configured.
- Effective permissions are fetched from the database for each request, so role changes do not wait for JWT expiry.
- Technician access to work orders is constrained by assigned-job queries and service-layer ownership checks; Service Report detail also checks `read` versus `read_own` at the service layer. These patterns reduce common IDOR risk, though DB-backed role tests could not be run here.
- Customer documents use a 25 MB upload cap, MIME allowlist, and signed retrieval URLs. Service Report upload additionally validates file signatures and supports idempotency keys.
- The audit service has append/query methods only, and the SQL grant script denies runtime UPDATE/DELETE on `audit_logs`.
- No `.env` file was present. No production credentials or API keys were found in the files reviewed; only documented development placeholders/defaults are present.

## Not verified

- Actual production CORS, TLS termination, reverse proxy, Redis ACL/TLS, database grants, object-storage bucket policy, and host OS.
- Live role-by-role authorization behavior, cross-record access, and database row constraints.
- Rate limiting across multiple API replicas (the configured default store is process-local unless deployment wiring changes it).
- Upload parser behavior under malformed files, signed URL expiration under clock skew, and external S3/Vertex credentials.

See `IMPROVEMENT_ROADMAP.md` for proposed sequencing. No security probes were run against production services.
