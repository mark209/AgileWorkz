# Rev 7 Blueprint — Summary

Full interactive version was reviewed and approved outside this repo. This
file is a durable, plain-text reference for the decisions that drive Phase 1
and beyond.

## Stack (locked in)

PostgreSQL, React/Next.js, NestJS, TypeScript throughout, modular monolith
(no microservices for V1), object storage for uploaded documents,
Redis-backed job queue, PWA-ready technician client, Singapore-region
hosting preferred.

## Roles (V1)

Admin/Owner, Manager, Office Staff, Technician — permission-driven via
`user_roles` → `roles` → `role_permissions` → `permissions` (many-to-many
user↔role, decided in the Phase 1 revision).

## Operations (Phase 4, COMPLETE / FROZEN)

Work Orders and technician assignment. The backend (schema, RBAC,
lifecycle, numbering, assignment model) was built earlier; this closure
covers the Operations Frontend — `apps/web`'s staff Work Order screens,
`apps/field`'s technician screens (My Jobs, Start Job, Service Report
upload), and three new minimal read-only endpoints (`GET
/users/technicians`, `GET /work-orders/:id/service-reports`, `GET
/service-reports/types`), all reusing existing permissions. No new
permission, no schema change. Service Report upload confirmed to still
route through the full, unmodified Phase 5 pipeline regardless of Work
Order linkage. See `phase4-operations-frontend-baseline.md` for the full
frozen record — lifecycle transitions, RBAC matrix, technician
ownership rules, and live validation results.

## Service Report architecture (Phase 5, COMPLETE / FROZEN)

```
Original Document
  → OCR/AI Extraction        [Steps 1-4: FROZEN, see phase5-extraction-reliability-baseline.md]
  → Extraction Staging      (extraction_* tables — AI writes here only)
  → Human Verification       [Step 5: FROZEN, see phase5-step5-verification-baseline.md]
  → Confirm Report          (the ONLY writer of canonical tables)   [Step 6: FROZEN, see phase5-step6-confirm-baseline.md]
  → Canonical Service Report Data
  → LOCKED                                                          [Step 7: FROZEN, see phase5-step7-lock-baseline.md]
```

Phase 5 — Service Report Intake is complete.

## Dashboard (Phase 6, COMPLETE / FROZEN)

A single-page operational overview (KPI cards + Recent Activity), built
entirely on Phase 1–5 data via existing permissions plus two new minimal,
permission-identical list endpoints (`GET /quotations?status=...`, `GET
/work-orders?status=...`). No new permission, no schema change, no
aggregate table, no charts. See `phase6-dashboard-baseline.md` for the full
frozen record — KPI sources, role visibility matrix, the
not-fetched-not-merely-hidden omission rule, and live validation results
across all four roles.

Phase 6 — Dashboard is complete. Next up per the development phases list
below: **Phase 7 — Hardening.**

Six staging tables mirror six canonical tables. No AI/OCR process may ever
write directly to a canonical `service_report_*` table — enforced at both
the application layer and, once built, the database grant level (see
`ocr-worker-db-isolation.md`).

Work Orders are optional on a Service Report (`work_order_id` nullable);
`source_type` records why the service happened when there's no Work Order.
Customer + Site are mandatory either way.

## Confirmed business policy

- Quotation approval: ≤ ₱50,000 and ≤10% discount = standard; above either =
  Manager approval; Admin/Owner may always override (audited). Thresholds
  live in `system_settings`, not hard-coded.
- Verifier ≠ uploader: enforced as a row-level rule independent of role.
- Retention: 7-year default, configurable via `system_settings`. Original
  signed documents are never deleted during normal correction.
- Single company (AgileWorks Solutions OPC) for V1; multi-branch is a
  documented, not-yet-built V2 addition.
- Customer Portal is out of scope for V1.

## Development phases

1. **Foundation** (this repo, so far) — auth, users, roles, permissions,
   system_settings, audit log.
2. Customer Data — customers, contacts, sites, assets.
3. Sales Pipeline — inquiries, quotations, threshold-based approval.
4. Operations — work orders, technician assignment. **COMPLETE / FROZEN** — see `phase4-operations-frontend-baseline.md`.
5. Service Report Intake — the full staging/canonical pipeline above. **COMPLETE / FROZEN.**
6. Dashboard. **COMPLETE / FROZEN** — see `phase6-dashboard-baseline.md`.
7. Hardening. **Next up.**
