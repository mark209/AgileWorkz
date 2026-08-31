-- Phase 5 Step 6 (Confirm Report) — additive only.
--
-- Adds one nullable traceability column to service_report_measurements:
-- source_field_name, a denormalized copy of the originating
-- extraction_measurements.field_name. Needed because measurement_type_code
-- is NOT NULL and Confirm falls back to the seeded OTHER_UNMAPPED code
-- (see prisma/seed.ts) when a verified measurement's taxonomy cannot be
-- deterministically resolved — source_row_index alone cannot disambiguate
-- which staging field a canonical row came from, since several distinct
-- readings legitimately share one row_index (one physical equipment unit
-- has many readings). Written by Confirm for every measurement row, not
-- only unmapped ones, so provenance is uniform and the canonical viewer
-- can display it without joining back to staging.
--
-- No existing column, table, constraint, or grant is touched. app_runtime's
-- existing table-level grant on service_report_measurements (infra/sql/
-- grant-runtime-privileges.sql) already covers new columns on this table.

-- AlterTable
ALTER TABLE "service_report_measurements"
  ADD COLUMN "source_field_name" VARCHAR(60);
