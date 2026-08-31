-- Phase 5 Step 1 — Service Report Intake: schema & migration only.
-- Reconstructed from the Rev 7 blueprint summary's fixed pipeline
-- (Original Document -> OCR/AI Extraction -> Extraction Staging -> Human
-- Verification -> Confirm Report -> Canonical Data -> LOCKED), the Phase 1
-- policy record docs/architecture/ocr-worker-db-isolation.md, and the
-- approved Phase 5 Baseline (OD1-OD8, all resolved). No Phase 1-4 table,
-- column, constraint, or grant is touched — purely additive throughout.
--
-- 3 new enums, 12 new tables, 2 additive values on existing enums
-- (DocumentRelatedType, NumberSeries).
--
-- Key design points carried over from the approved baseline:
--   OD1 — service_reports exists from upload onward (status-driven), not
--         only once "canonical" — its own content columns populate later.
--   OD3 — service_reports IS the canonical mirror of extraction_basic_info;
--         5 further canonical child tables mirror the other 5 staging
--         tables (equipment_units, problems, measurements, narrative_items,
--         signoffs).
--   OD4 — every extraction_* row carries BOTH ai_value/ai_confidence
--         (written once, by the OCR worker, never touched again) and
--         verified_value/verified_by/verified_at (written only by a human
--         via the future verification endpoint). Correcting a field never
--         destroys the AI's original read.
--   OD5 — confirmed_at/by and locked_at/by are separate actor/timestamp
--         pairs on service_reports, matching Work Order's completed/closed
--         precedent (Phase 4 D2) — CONFIRMED and LOCKED are kept distinct.
--
-- The six extraction_* table names and their eventual ocr_worker grant
-- shape are fixed by the Phase 1 policy record referenced above, not new
-- design; everything else about their internal shape (the shared generic
-- field-value pattern, sourceRowIndex traceability on canonical rows) is
-- new Step 1 design, presented for review in the Step 1 completion report.

-- CreateEnum
CREATE TYPE "ServiceReportStatus" AS ENUM ('PENDING_EXTRACTION', 'EXTRACTION_FAILED', 'PENDING_VERIFICATION', 'VERIFIED', 'CONFIRMED', 'LOCKED');

-- CreateEnum
CREATE TYPE "ServiceReportSourceType" AS ENUM ('EMERGENCY', 'WARRANTY', 'CALLBACK', 'INTERNAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ExtractionConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'UNREADABLE');

-- AlterEnum
ALTER TYPE "DocumentRelatedType" ADD VALUE 'SERVICE_REPORT';

-- AlterEnum
ALTER TYPE "NumberSeries" ADD VALUE 'SERVICE_REPORT';

-- CreateTable
CREATE TABLE "service_reports" (
    "id" TEXT NOT NULL,
    "service_report_number" VARCHAR(30) NOT NULL,
    "customer_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "work_order_id" TEXT,
    "source_type" "ServiceReportSourceType",
    "status" "ServiceReportStatus" NOT NULL DEFAULT 'PENDING_EXTRACTION',
    "technician_name" VARCHAR(160),
    "service_date" DATE,
    "report_reference_number" VARCHAR(60),
    "general_notes" TEXT,
    "uploaded_by" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL,
    "verified_by" TEXT,
    "verified_at" TIMESTAMP(3),
    "confirmed_by" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "locked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_report_equipment_units" (
    "id" TEXT NOT NULL,
    "service_report_id" TEXT NOT NULL,
    "unit_tag" VARCHAR(100),
    "description" VARCHAR(255) NOT NULL,
    "location" VARCHAR(160),
    "model_number" VARCHAR(100),
    "serial_number" VARCHAR(100),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "source_row_index" INTEGER,

    CONSTRAINT "service_report_equipment_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_report_problems" (
    "id" TEXT NOT NULL,
    "service_report_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "resolved" BOOLEAN,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "source_row_index" INTEGER,

    CONSTRAINT "service_report_problems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_report_measurements" (
    "id" TEXT NOT NULL,
    "service_report_id" TEXT NOT NULL,
    "measurement_type" VARCHAR(120) NOT NULL,
    "value" VARCHAR(60) NOT NULL,
    "unit" VARCHAR(30),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "source_row_index" INTEGER,

    CONSTRAINT "service_report_measurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_report_narrative_items" (
    "id" TEXT NOT NULL,
    "service_report_id" TEXT NOT NULL,
    "category" VARCHAR(100),
    "description" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "source_row_index" INTEGER,

    CONSTRAINT "service_report_narrative_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_report_signoffs" (
    "id" TEXT NOT NULL,
    "service_report_id" TEXT NOT NULL,
    "signoff_role" VARCHAR(60) NOT NULL,
    "signatory_name" VARCHAR(160),
    "signed" BOOLEAN NOT NULL DEFAULT false,
    "signed_date" DATE,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "source_row_index" INTEGER,

    CONSTRAINT "service_report_signoffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction_basic_info" (
    "id" TEXT NOT NULL,
    "service_report_id" TEXT NOT NULL,
    "row_index" INTEGER NOT NULL DEFAULT 0,
    "field_name" VARCHAR(60) NOT NULL,
    "ai_value" TEXT,
    "ai_confidence" "ExtractionConfidence",
    "verified_value" TEXT,
    "verified_by" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extraction_basic_info_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction_equipment_units" (
    "id" TEXT NOT NULL,
    "service_report_id" TEXT NOT NULL,
    "row_index" INTEGER NOT NULL DEFAULT 0,
    "field_name" VARCHAR(60) NOT NULL,
    "ai_value" TEXT,
    "ai_confidence" "ExtractionConfidence",
    "verified_value" TEXT,
    "verified_by" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extraction_equipment_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction_problems" (
    "id" TEXT NOT NULL,
    "service_report_id" TEXT NOT NULL,
    "row_index" INTEGER NOT NULL DEFAULT 0,
    "field_name" VARCHAR(60) NOT NULL,
    "ai_value" TEXT,
    "ai_confidence" "ExtractionConfidence",
    "verified_value" TEXT,
    "verified_by" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extraction_problems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction_measurements" (
    "id" TEXT NOT NULL,
    "service_report_id" TEXT NOT NULL,
    "row_index" INTEGER NOT NULL DEFAULT 0,
    "field_name" VARCHAR(60) NOT NULL,
    "ai_value" TEXT,
    "ai_confidence" "ExtractionConfidence",
    "verified_value" TEXT,
    "verified_by" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extraction_measurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction_narrative_items" (
    "id" TEXT NOT NULL,
    "service_report_id" TEXT NOT NULL,
    "row_index" INTEGER NOT NULL DEFAULT 0,
    "field_name" VARCHAR(60) NOT NULL,
    "ai_value" TEXT,
    "ai_confidence" "ExtractionConfidence",
    "verified_value" TEXT,
    "verified_by" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extraction_narrative_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction_signoffs" (
    "id" TEXT NOT NULL,
    "service_report_id" TEXT NOT NULL,
    "row_index" INTEGER NOT NULL DEFAULT 0,
    "field_name" VARCHAR(60) NOT NULL,
    "ai_value" TEXT,
    "ai_confidence" "ExtractionConfidence",
    "verified_value" TEXT,
    "verified_by" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extraction_signoffs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_reports_service_report_number_key" ON "service_reports"("service_report_number");

-- CreateIndex
CREATE INDEX "service_reports_customer_id_idx" ON "service_reports"("customer_id");

-- CreateIndex
CREATE INDEX "service_reports_site_id_idx" ON "service_reports"("site_id");

-- CreateIndex
CREATE INDEX "service_reports_work_order_id_idx" ON "service_reports"("work_order_id");

-- CreateIndex
CREATE INDEX "service_reports_status_idx" ON "service_reports"("status");

-- CreateIndex
CREATE INDEX "service_report_equipment_units_service_report_id_idx" ON "service_report_equipment_units"("service_report_id");

-- CreateIndex
CREATE INDEX "service_report_problems_service_report_id_idx" ON "service_report_problems"("service_report_id");

-- CreateIndex
CREATE INDEX "service_report_measurements_service_report_id_idx" ON "service_report_measurements"("service_report_id");

-- CreateIndex
CREATE INDEX "service_report_narrative_items_service_report_id_idx" ON "service_report_narrative_items"("service_report_id");

-- CreateIndex
CREATE INDEX "service_report_signoffs_service_report_id_idx" ON "service_report_signoffs"("service_report_id");

-- CreateIndex
CREATE INDEX "extraction_basic_info_service_report_id_idx" ON "extraction_basic_info"("service_report_id");

-- CreateIndex
CREATE UNIQUE INDEX "extraction_basic_info_service_report_id_row_index_field_nam_key" ON "extraction_basic_info"("service_report_id", "row_index", "field_name");

-- CreateIndex
CREATE INDEX "extraction_equipment_units_service_report_id_idx" ON "extraction_equipment_units"("service_report_id");

-- CreateIndex
CREATE UNIQUE INDEX "extraction_equipment_units_service_report_id_row_index_fiel_key" ON "extraction_equipment_units"("service_report_id", "row_index", "field_name");

-- CreateIndex
CREATE INDEX "extraction_problems_service_report_id_idx" ON "extraction_problems"("service_report_id");

-- CreateIndex
CREATE UNIQUE INDEX "extraction_problems_service_report_id_row_index_field_name_key" ON "extraction_problems"("service_report_id", "row_index", "field_name");

-- CreateIndex
CREATE INDEX "extraction_measurements_service_report_id_idx" ON "extraction_measurements"("service_report_id");

-- CreateIndex
CREATE UNIQUE INDEX "extraction_measurements_service_report_id_row_index_field_n_key" ON "extraction_measurements"("service_report_id", "row_index", "field_name");

-- CreateIndex
CREATE INDEX "extraction_narrative_items_service_report_id_idx" ON "extraction_narrative_items"("service_report_id");

-- CreateIndex
CREATE UNIQUE INDEX "extraction_narrative_items_service_report_id_row_index_fiel_key" ON "extraction_narrative_items"("service_report_id", "row_index", "field_name");

-- CreateIndex
CREATE INDEX "extraction_signoffs_service_report_id_idx" ON "extraction_signoffs"("service_report_id");

-- CreateIndex
CREATE UNIQUE INDEX "extraction_signoffs_service_report_id_row_index_field_name_key" ON "extraction_signoffs"("service_report_id", "row_index", "field_name");

-- AddForeignKey
ALTER TABLE "service_reports" ADD CONSTRAINT "service_reports_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_reports" ADD CONSTRAINT "service_reports_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_reports" ADD CONSTRAINT "service_reports_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_reports" ADD CONSTRAINT "service_reports_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_reports" ADD CONSTRAINT "service_reports_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_reports" ADD CONSTRAINT "service_reports_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_reports" ADD CONSTRAINT "service_reports_locked_by_fkey" FOREIGN KEY ("locked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_report_equipment_units" ADD CONSTRAINT "service_report_equipment_units_service_report_id_fkey" FOREIGN KEY ("service_report_id") REFERENCES "service_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_report_problems" ADD CONSTRAINT "service_report_problems_service_report_id_fkey" FOREIGN KEY ("service_report_id") REFERENCES "service_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_report_measurements" ADD CONSTRAINT "service_report_measurements_service_report_id_fkey" FOREIGN KEY ("service_report_id") REFERENCES "service_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_report_narrative_items" ADD CONSTRAINT "service_report_narrative_items_service_report_id_fkey" FOREIGN KEY ("service_report_id") REFERENCES "service_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_report_signoffs" ADD CONSTRAINT "service_report_signoffs_service_report_id_fkey" FOREIGN KEY ("service_report_id") REFERENCES "service_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_basic_info" ADD CONSTRAINT "extraction_basic_info_service_report_id_fkey" FOREIGN KEY ("service_report_id") REFERENCES "service_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_basic_info" ADD CONSTRAINT "extraction_basic_info_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_equipment_units" ADD CONSTRAINT "extraction_equipment_units_service_report_id_fkey" FOREIGN KEY ("service_report_id") REFERENCES "service_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_equipment_units" ADD CONSTRAINT "extraction_equipment_units_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_problems" ADD CONSTRAINT "extraction_problems_service_report_id_fkey" FOREIGN KEY ("service_report_id") REFERENCES "service_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_problems" ADD CONSTRAINT "extraction_problems_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_measurements" ADD CONSTRAINT "extraction_measurements_service_report_id_fkey" FOREIGN KEY ("service_report_id") REFERENCES "service_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_measurements" ADD CONSTRAINT "extraction_measurements_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_narrative_items" ADD CONSTRAINT "extraction_narrative_items_service_report_id_fkey" FOREIGN KEY ("service_report_id") REFERENCES "service_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_narrative_items" ADD CONSTRAINT "extraction_narrative_items_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_signoffs" ADD CONSTRAINT "extraction_signoffs_service_report_id_fkey" FOREIGN KEY ("service_report_id") REFERENCES "service_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_signoffs" ADD CONSTRAINT "extraction_signoffs_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
