-- AgileWorks HVAC ERP — app_runtime table-level grants, POST-MIGRATION.
--
-- Run this AFTER `prisma migrate deploy` has created the Phase 1 tables —
-- it references them by name and will fail with "relation ... does not
-- exist" if run first (that's exactly what happened when this was still
-- bundled into provision-roles.sql and run before migration).
--
-- Connect as app_migrator (the role that owns these tables) or the
-- postgres superuser — app_runtime itself has no GRANT authority.
--
-- IMPORTANT — re-run this after ANY schema rebuild, not just the first
-- migration: `prisma migrate reset` (or any DROP SCHEMA / DROP DATABASE +
-- recreate) drops these tables and everything granted on them. Roles
-- (app_migrator, app_runtime) are cluster-level objects and survive a reset
-- untouched; table-level GRANTs do not, because they're tied to the specific
-- (now-dropped) table objects, not the role. If audit_logs (or any Phase 1
-- table) suddenly denies app_runtime even SELECT after a reset, this is why
-- — re-run this script, don't touch the role/policy design.

-- Full DML on the Phase 1 platform tables the app manages...
GRANT SELECT, INSERT, UPDATE, DELETE ON
  users, user_roles, roles, permissions, role_permissions, system_settings
  TO app_runtime;

-- ...except audit_logs, which is append-only: INSERT + SELECT only.
-- This is the database itself enforcing "no update/delete of audit history",
-- independent of whatever the application code does or doesn't do.
GRANT SELECT, INSERT ON audit_logs TO app_runtime;
REVOKE UPDATE, DELETE ON audit_logs FROM app_runtime;

-- Sequences (Prisma uses UUIDs generated client-side for these Phase 1
-- tables, so no serial sequences are expected — this is a no-op placeholder
-- kept here in case a future table introduces one).
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;

-- ---------------------------------------------------------------------------
-- Phase 2 — Customer, Site & Equipment domain. Same rationale as above: these
-- 9 tables didn't exist when provision-roles.sql ran, so their grants belong
-- here, post-migration, not there. Re-run this whole file (not just this
-- section) after any schema rebuild — see the IMPORTANT note above.
-- ---------------------------------------------------------------------------

-- Full DML on every Phase 2 table. None of these are append-only audit
-- records like audit_logs — all nine get the same unrestricted treatment as
-- the Phase 1 business tables above (the app's own code, not the DB grant,
-- enforces "disable via status, don't DELETE" for these).
GRANT SELECT, INSERT, UPDATE, DELETE ON
  customers, contacts, sites, equipment_types, equipment_system_types,
  capacity_units, equipment_systems, assets, customer_documents
  TO app_runtime;

-- ---------------------------------------------------------------------------
-- Phase 3 Step 1 — Sales Workflow schema (Inquiries -> Quotations ->
-- Revisions). Same rationale as above: these 9 tables didn't exist when
-- provision-roles.sql ran, so their grants belong here, post-migration, not
-- there. Re-run this whole file (not just this section) after any schema
-- rebuild — see the IMPORTANT note above.
-- ---------------------------------------------------------------------------

-- Full DML on every Phase 3 Step 1 table. None of these are append-only audit
-- records like audit_logs — all nine get the same unrestricted treatment as
-- the Phase 1/2 business tables above (the app's own code, not the DB grant,
-- enforces "disable via status, don't DELETE" for trades/quotation_term_
-- templates/quotations, and "immutable once non-DRAFT" for revisions and
-- everything under them — see the approved Phase 3 plan §05).
-- `quotation_number_counters` was renamed/generalized to
-- `document_number_counters` in the Step 3 correction (see below) — it never
-- appears here under its old name.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  trades, quotation_term_templates, quotations,
  quotation_revisions, quotation_sections, quotation_line_items,
  quotation_maintenance_details, quotation_testing_commissioning_items
  TO app_runtime;

-- ---------------------------------------------------------------------------
-- Phase 3 Step 3 — Inquiries, plus the Step 3 correction: the generalized
-- document_number_counters numbering engine (replaces the Step 1
-- quotation_number_counters table) and the two new inquiry_sources/
-- inquiry_types reference tables. Same rationale as above: none of these
-- existed when provision-roles.sql ran, so their grants belong here,
-- post-migration, not there.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON
  inquiries, inquiry_sources, inquiry_types, document_number_counters
  TO app_runtime;

-- ---------------------------------------------------------------------------
-- Phase 4 Step 1 — Operations: Work Orders & Technician Assignment. Same
-- rationale as above: these 4 tables didn't exist when provision-roles.sql
-- ran, so their grants belong here, post-migration, not there. Re-run this
-- whole file (not just this section) after any schema rebuild — see the
-- IMPORTANT note above.
-- ---------------------------------------------------------------------------

-- Full DML on every Phase 4 Step 1 table. None of these are append-only
-- audit records like audit_logs — all four get the same unrestricted
-- treatment as every other business table above (the app's own code, not
-- the DB grant, enforces "immutable once non-DRAFT"-equivalent rules like
-- the approved lifecycle state machine, the request/confirm cancellation
-- split, and Manager/Admin-Owner-only CLOSE).
GRANT SELECT, INSERT, UPDATE, DELETE ON
  work_orders, work_order_assignments, work_order_tasks, work_order_actual_costs
  TO app_runtime;

-- ---------------------------------------------------------------------------
-- Phase 5 Step 1 — Service Report Intake: schema & migration only. Same
-- rationale as above: these 12 tables didn't exist when provision-roles.sql
-- ran, so their grants belong here, post-migration, not there. Re-run this
-- whole file (not just this section) after any schema rebuild — see the
-- IMPORTANT note above.
-- ---------------------------------------------------------------------------

-- app_runtime gets full DML on every Phase 5 table — the header, the 5
-- canonical child tables, and the 6 extraction_* staging tables alike. Same
-- "app code enforces the real rules, not the grant" precedent as every
-- other business table above: the DB grant does not by itself distinguish
-- "confirmed data" from "still-being-verified data" or enforce the LOCKED
-- terminal state — the service layer (Step 5+) does that. What the DB grant
-- DOES enforce absolutely, with no application-layer escape hatch, is the
-- ocr_worker isolation below.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  service_reports,
  service_report_equipment_units, service_report_problems, service_report_measurements,
  service_report_narrative_items, service_report_signoffs,
  extraction_basic_info, extraction_equipment_units, extraction_problems,
  extraction_measurements, extraction_narrative_items, extraction_signoffs
  TO app_runtime;

-- Phase 5 Step 1 amendment (Decision 1) — the two new reference tables,
-- same full-DML treatment as every other reference table in this file
-- (capacity_units, equipment_types, etc.). Added here, not folded silently
-- into the block above, because it was missed on the first pass of this
-- amendment and caught by the post-migration grant audit — see the amended
-- Step 1 report.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  measurement_types, signoff_roles
  TO app_runtime;

-- Phase 5 Step 1 correction round — three more additions from the same
-- correction: service_report_types (new reference table, same treatment as
-- every other reference table here), service_report_technicians (new
-- canonical child table, same full-DML treatment as every other Service
-- Report table above), and measurement_stages (the revised
-- Recommendation B reference table, replacing what would have been a
-- hardcoded enum).
GRANT SELECT, INSERT, UPDATE, DELETE ON
  service_report_types, service_report_technicians, measurement_stages
  TO app_runtime;

-- Phase 5 Step 1 correction round 2 (Recommendation H) — problem_types,
-- same reference-table treatment as every other taxonomy table above.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  problem_types
  TO app_runtime;

-- ocr_worker — the Phase 1 policy record's non-negotiable rule, executed
-- exactly as specified in docs/architecture/ocr-worker-db-isolation.md:
-- SELECT, INSERT, UPDATE on exactly these six tables, granted table-by-table
-- (never a schema-wide grant), and NO grant of any kind — not even SELECT —
-- on any service_report_* canonical table, or on anything else in the
-- schema. This is what makes "AI/OCR output must never write directly to a
-- canonical table" a database-enforced guarantee, not merely an
-- application-layer convention that a bug could violate.
GRANT SELECT, INSERT, UPDATE ON extraction_basic_info TO ocr_worker;
GRANT SELECT, INSERT, UPDATE ON extraction_equipment_units TO ocr_worker;
GRANT SELECT, INSERT, UPDATE ON extraction_problems TO ocr_worker;
GRANT SELECT, INSERT, UPDATE ON extraction_measurements TO ocr_worker;
GRANT SELECT, INSERT, UPDATE ON extraction_narrative_items TO ocr_worker;
GRANT SELECT, INSERT, UPDATE ON extraction_signoffs TO ocr_worker;
