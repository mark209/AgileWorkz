# Dependency Audit

**Audit date:** 2026-10-11  
**Branch:** `audit/system-improvements`  
**Package manager:** pnpm 11.19.0  
**Lockfile:** `pnpm-lock.yaml` (frozen install succeeded)  
**Runtime used:** Node.js 24.13.1 (repository requires Node.js >=20)

## Executive result

`pnpm install --frozen-lockfile` installed 1,135 package versions from the committed lockfile. `pnpm audit --json` evaluated 1,222 dependency paths and reported **5 critical, 33 high, 37 moderate, and 11 low** advisories. This is a verified registry audit result, not a claim that every advisory is exploitable through this application. The strongest release concern is Next.js 14.2.35 in both production frontends: it is outside the supported Next.js lines and the registry reports two critical RCE advisories.

No dependencies were upgraded. `pnpm outdated -r --long` reports that several direct packages have newer versions; the command exits non-zero when updates exist. Current versions and update notes below were queried from the npm registry on the audit date.

## Workspace dependency inventory

The workspace has six projects including the root, with 101 declared direct dependency entries across the root and four packages/apps. The table lists the primary runtime and build/test dependencies from `pnpm list -r --depth=0`; the lockfile and audit command cover the complete transitive tree.

| Area | Installed versions |
|---|---|
| Runtime/tooling | Node 24.13.1; pnpm 11.19.0; TypeScript 5.9.3 |
| API | NestJS 10.4.22; Prisma Client/CLI 5.22.0; PostgreSQL driver via Prisma; BullMQ 5.81.3; ioredis 5.11.1; AWS S3 SDK 3.1110.0; Google GenAI 2.17.1; Joi 17.13.4; Multer 2.3.0; Argon2 0.41.1; `@react-pdf/renderer` 3.4.5 |
| Office frontend | Next.js 14.2.35; React/React DOM 18.3.1; Tailwind CSS 3.4.19; Radix UI; Vitest 4.1.11 |
| Field frontend | Next.js 14.2.35; React/React DOM 18.3.1; Vitest 4.1.11 |
| API tests/build | Jest 29.7.0; ts-jest 29.4.12; ESLint 8.57.1 |

The complete direct list is reproducible with `pnpm list -r --depth=0`. Registry security and version comparisons are reproducible with `pnpm audit --json` and `pnpm outdated -r --long`.

## Verified advisory findings

| ID | Package and installed path | Severity | Advisory / affected code | Patched version and action | Compatibility / verification |
|---|---|---:|---|---|---|
| DEP-001 | `next` 14.2.35, direct production dependency in `apps/web` and `apps/field` | Critical | Two advisories: [Windows-hosted RCE, GHSA-p293-qw3h-jr36](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36) and [AVIF Image Optimization RCE, GHSA-2xp9-vwfh-vxw4](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4). The first applies to affected router configurations on Windows hosts; the second requires AVIF optimization. Production host and image traffic were not established. | Minimum patched release in the affected 15.x line is 15.5.24; 16.3.3 patches these advisories. The current registry latest queried was 16.4.0. Plan a tested move to a currently supported release (16.x Active LTS; 15.x Maintenance LTS), rather than remaining on unsupported 14.x. | Verified installed version and advisories. Crosses Next and React major versions; Next 15/16 changes and React 19 migration require a staged upgrade and full route/auth/upload regression checks. Next’s [support policy](https://nextjs.org/support-policy) lists 14.x as unsupported. |
| DEP-002 | `proxy-addr` 2.0.7, transitive production dependency via NestJS/Express | Critical advisory; conditional exploitability | [GHSA-jqcg-44mw-7w3h](https://github.com/jshttp/proxy-addr/security/advisories/GHSA-jqcg-44mw-7w3h): IP spoofing occurs when a trust subnet is configured in an incorrect IPv4-mapped IPv6 form. This repository currently configures `trust proxy` as a numeric hop count (`apps/api/src/main.ts:32`, `TRUST_PROXY_HOPS`), not a subnet, so the advisory’s specific vulnerable configuration was not found. | 2.0.8 or later; keep the numeric hop-count policy and add a lockfile override if the upstream Express tree does not resolve a fixed version. | Advisory and installed path verified; exploitability in the current configuration is not confirmed. Test both direct traffic and the real proxy topology after upgrade. |
| DEP-003 | `handlebars` 4.7.9, transitive **development-only** dependency via `ts-jest` | Critical advisories (development dependency) | [GHSA-8r5x-fm3f-whwj](https://github.com/handlebars-lang/handlebars.js/security/advisories/GHSA-8r5x-fm3f-whwj) and [GHSA-p8wg-vrv2-v86f](https://github.com/advisories/GHSA-p8wg-vrv2-v86f). The code injection condition involves compiling attacker-controlled parsed template ASTs. No production path or application use of Handlebars was found. | 4.7.10 or later via an upstream `ts-jest` update or a narrow pnpm override. | Registry finding verified; direct application exploitability not established. Treat as a CI/developer-environment risk, not a production runtime finding. |
| DEP-004 | `joi` 17.13.4, direct production dependency in `apps/api` | High and moderate | [GHSA-6h2x-m376-mqjq](https://github.com/advisories/GHSA-6h2x-m376-mqjq) affects `string().isoDate()`; [GHSA-wr44-6hxh-3jwq](https://github.com/advisories/GHSA-wr44-6hxh-3jwq) concerns prototype replacement via compiled messages. The app’s environment schema uses Joi strings, URI validation, and numeric validation; no `.isoDate()` use was found. | 17.13.8 or later within the 17.x line; version 18.2.9 was the registry latest at audit time but is a major upgrade. | Advisory/version verified. High-CPU behavior is not confirmed reachable through current DTO/environment validation. Patch within major 17 first and run env validation tests. |
| DEP-005 | `lodash` 4.17.21, transitive production dependency via `@nestjs/config` | High and moderate | [GHSA-r5fr-rjxr-66jc](https://github.com/advisories/GHSA-r5fr-rjxr-66jc) reports code injection through `_.template` imports; related prototype-pollution advisories include [GHSA-xxjr-mmjv-4gpg](https://github.com/advisories/GHSA-xxjr-mmjv-4gpg). The audit path is `apps__api>@nestjs/config>lodash`; no direct application use was found. | 4.17.24 or later. Prefer an upstream dependency update or a narrow override after compatibility checks. | Package paths and advisories verified; vulnerable function reachability was not established. |
| DEP-006 | `multer` 2.3.0, direct API dependency and present in the Nest/Express transitive path; the workspace override currently permits `^2.3.0` | Moderate | [GHSA-3pph-fpjx-jg34](https://github.com/advisories/GHSA-3pph-fpjx-jg34) reports DoS from orphaned disk writes on aborted uploads. Upload interceptors set 25 MB limits and do not configure disk storage, so the advisory’s disk-write condition was not observed in this code. | 2.4.0 or later. Update the direct range and `pnpm-workspace.yaml` override together, then verify both upload endpoints and the lockfile. | Advisory/version verified; current exposure is conditional on storage mode and request behavior. |

The npm audit count includes additional high/moderate/low advisories in transitive packages. The high findings above are not asserted to be exploitable without their affected code paths. The security report records application-specific reachability separately.

## Outdated versions and compatibility notes

| Package | Installed | Registry latest queried | Recommendation |
|---|---:|---:|---|
| Next.js | 14.2.35 | 16.4.0 | Upgrade both apps together to a supported line; major migration and React compatibility work required. |
| React / React DOM | 18.3.1 | 19.3.0 | Coordinate with Next upgrade; check React 19 behavior and typings. |
| Joi | 17.13.4 | 18.2.9 | Patch to 17.13.8 first to minimize major-upgrade risk. |
| Multer | 2.3.0 | 2.4.0 | Upgrade to at least 2.4.0 and adjust the workspace override. |
| Prisma Client / CLI | 5.22.0 | 8.0.0-rc.22 | The registry’s latest result was a release candidate; do not treat it as a production target. Select a stable version, upgrade CLI and client together, and rehearse migrations/backups. |
| Vitest | 4.1.11 | 5.0.3 | Major update; current UI tests pass on 4.1.11. Review config-loader migration warnings before changing. |
| TypeScript | 5.9.3 | 7.0.2 | Major compiler change; validate Nest, Next, and shared types before selecting a target. |

`pnpm outdated` also reports ordinary minor/patch updates for AWS SDK, Radix UI, `@google/genai`, PostCSS, and development tools. They are not individually promoted to security issues unless `pnpm audit` identifies an advisory. No bulk upgrade is recommended.

## Package-manager, lockfile, and licensing notes

- The frozen lockfile install succeeded and the workspace policy lists explicitly allowed native build scripts. A small number of native packages ran install scripts as declared by the package manager.
- `package.json` does not pin a `packageManager` version. Add a package-manager pin and CI install command to make local/CI resolution more reproducible.
- The code declares Node.js `>=20`, and the tested runtime was Node 24.13.1. A clean Node 20 CI run was not available.
- No direct dependency was reported deprecated in the queried outdated output. An exhaustive maintenance/last-release review of all 1,222 dependency paths was not performed.
- No license-scanning utility was present in the project scripts or available audit output. Licensing for the complete transitive tree is therefore **not verified**; run a license inventory before redistribution or commercial deployment.
- No dependency was conclusively unused from this audit. A dedicated import-to-manifest analysis was not run.

## Verification record

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Passed; 1,135 packages installed; no lockfile modification requested. |
| `pnpm list -r --depth=0` | Completed; 101 direct dependency entries across six workspace projects. |
| `pnpm audit --json` | Completed against the configured registry; 5 critical, 33 high, 37 moderate, 11 low. Exit code 1 reflects findings. |
| `pnpm outdated -r --long` | Completed; newer versions exist. Exit code 1 reflects outdated packages. |
| Dependency upgrades | None performed. |
| Exact malicious-input exploit checks | Not performed; production services were not available and the audit was static. |
