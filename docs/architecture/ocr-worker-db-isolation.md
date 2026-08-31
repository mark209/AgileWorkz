# OCR/AI Worker Database Isolation — Policy Record

**Status:** Decision recorded in Phase 1. Nothing implemented yet — this document
is the Phase 1 deliverable itself, per the approved plan. No `extraction_*`
tables exist; no `ocr_worker` database role is created in Phase 1.

## Why this exists

The Rev 7 blueprint's non-negotiable rule: AI/OCR output must never write
directly to a canonical `service_report_*` table. The application-layer
design already enforces this (only the future "Confirm Report" transaction
writes canonical tables). This document is the plan for enforcing the same
rule one layer down, at the database grant level, so the guarantee doesn't
depend solely on application code being correct.

## What will happen in the Service Report phase (Phase 5)

1. A dedicated Postgres role, `ocr_worker`, is created — distinct from both
   `app_runtime` (the main API's connection) and `app_migrator` (deploy-time
   only). See `infra/sql/provision-roles.sql` for the pattern already in use
   for those two roles; `ocr_worker` follows the same shape.
2. `ocr_worker` is granted `SELECT, INSERT, UPDATE` on exactly the six
   staging tables, table-by-table — never a schema-wide grant:
   - `extraction_basic_info`
   - `extraction_equipment_units`
   - `extraction_problems`
   - `extraction_measurements`
   - `extraction_narrative_items`
   - `extraction_signoffs`
3. `ocr_worker` receives **no grant of any kind** — not `SELECT`, not
   `INSERT` — on any `service_report_*` canonical table, or on any other
   table in the schema (`users`, `audit_logs`, `customers`, etc.).
4. The extraction worker process (whatever runs the OCR/AI provider
   integration) connects to Postgres using only the `ocr_worker` credential,
   read from an environment variable, never the `app_runtime` credential.

## Verification (deferred to Phase 5)

An automated test will:

- Connect as `ocr_worker` and confirm reads/writes to all six `extraction_*`
  tables succeed.
- Connect as `ocr_worker` and confirm any write attempt to a
  `service_report_*` canonical table is rejected **by Postgres**, with a
  permission-denied error — not merely blocked by application logic.

This cannot be built or tested in Phase 1: there is nothing to grant access
to yet. Recorded here so Phase 5 implements this by design from its first
migration, not as an afterthought.
