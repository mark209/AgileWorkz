-- Phase 5 Step 1 correction round — applies your approved Recommendations
-- A, revised B, C, D, E (F deferred) plus the newly-identified Service
-- Report Type hierarchy gap, on top of the two already-applied Phase 5
-- Step 1 migrations. No Phase 1-4 table is touched. Every affected Phase 5
-- table was confirmed empty (zero rows) before this migration was written,
-- so the NOT NULL additions and the DROP COLUMN below carry no real
-- data-loss risk.
--
-- Recommendation A — service_report_measurements.equipment_unit_id
-- (nullable FK to service_report_equipment_units, SET NULL). A real sample
-- Maintenance Cleaning report showed every reading organized per equipment
-- unit; nothing previously linked a measurement to which unit it came from.
--
-- Recommendation B, REVISED — measurement "stage" (before/after cleaning,
-- before/after repair, ...) is now a controlled reference table
-- (measurement_stages) with a nullable FK
-- (service_report_measurements.stage_code, RESTRICT), NOT the hardcoded
-- two-value enum originally proposed. This preserves exact business
-- meaning per report type without ever redesigning this table again — a
-- new stage is a seeded row. The staging counterpart
-- (extraction_measurements.stage) is a plain nullable TEXT column, not a
-- FK — staging always holds raw, unverified OCR output; a human resolves
-- it to a real stage code only at Confirm time, same asymmetry already
-- used for measurement_type. extraction_measurements' uniqueness
-- constraint widens to include stage so the same field can appear twice
-- per equipment unit (once before, once after) without colliding.
-- Left unseeded in this step, same discipline as measurement_types/
-- signoff_roles.
--
-- Recommendation C — service_report_equipment_units.equipment_type_code
-- (required FK to the EXISTING Phase 2 equipment_types table — no
-- duplicate taxonomy invented) and .asset_id (nullable FK to the EXISTING
-- Phase 2 assets table, SET NULL — optional resolution to a real,
-- trackable physical unit for cross-visit service history).
--
-- Recommendation D — service_reports.time_in / time_out (nullable TIME).
-- Real sample reports show technicians writing these by hand in the
-- margin because the paper form has no printed field for them.
--
-- Recommendation E — new service_report_technicians child table (who
-- performed the work, possibly several people; technician_name always
-- captured raw, user_id an optional later resolution to a real ERP
-- account). service_reports.technician_name (singular) is DROPPED,
-- superseded by this table — keeping both would leave two ambiguous
-- sources for "who performed this."
--
-- New — service_report_types: the identified Service Report Type
-- hierarchy gap. Controlled reference table, same pattern as every other
-- taxonomy here. service_reports.report_type_code is REQUIRED (not
-- nullable) — every report has a definite business/template type from
-- creation — and, unlike measurement_types/signoff_roles/
-- measurement_stages, IS seeded in this round (see seed.ts) with the three
-- types explicitly approved: MAINTENANCE_CLEANING, GENERAL_SERVICE_REPAIR,
-- INSTALLATION_COMMISSIONING, plus OTHER (same universal catch-all
-- convention as every other reference table in this schema).

-- DropIndex
DROP INDEX "extraction_measurements_service_report_id_row_index_field_n_key";

-- AlterTable
ALTER TABLE "extraction_measurements" ADD COLUMN     "stage" VARCHAR(60);

-- AlterTable
ALTER TABLE "service_report_equipment_units" ADD COLUMN     "asset_id" TEXT,
ADD COLUMN     "equipment_type_code" VARCHAR(30) NOT NULL;

-- AlterTable
ALTER TABLE "service_report_measurements" ADD COLUMN     "equipment_unit_id" TEXT,
ADD COLUMN     "stage_code" VARCHAR(40);

-- AlterTable
ALTER TABLE "service_reports" DROP COLUMN "technician_name",
ADD COLUMN     "report_type_code" VARCHAR(40) NOT NULL,
ADD COLUMN     "time_in" TIME,
ADD COLUMN     "time_out" TIME;

-- CreateTable
CREATE TABLE "service_report_types" (
    "code" VARCHAR(40) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "ReferenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_report_types_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "service_report_technicians" (
    "id" TEXT NOT NULL,
    "service_report_id" TEXT NOT NULL,
    "technician_name" VARCHAR(160) NOT NULL,
    "user_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "service_report_technicians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurement_stages" (
    "code" VARCHAR(40) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "ReferenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "measurement_stages_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "service_report_types_status_idx" ON "service_report_types"("status");

-- CreateIndex
CREATE INDEX "service_report_technicians_service_report_id_idx" ON "service_report_technicians"("service_report_id");

-- CreateIndex
CREATE INDEX "service_report_technicians_user_id_idx" ON "service_report_technicians"("user_id");

-- CreateIndex
CREATE INDEX "measurement_stages_status_idx" ON "measurement_stages"("status");

-- CreateIndex
CREATE UNIQUE INDEX "extraction_measurements_service_report_id_row_index_field_n_key" ON "extraction_measurements"("service_report_id", "row_index", "field_name", "stage");

-- CreateIndex
CREATE INDEX "service_report_equipment_units_equipment_type_code_idx" ON "service_report_equipment_units"("equipment_type_code");

-- CreateIndex
CREATE INDEX "service_report_equipment_units_asset_id_idx" ON "service_report_equipment_units"("asset_id");

-- CreateIndex
CREATE INDEX "service_report_measurements_equipment_unit_id_idx" ON "service_report_measurements"("equipment_unit_id");

-- CreateIndex
CREATE INDEX "service_report_measurements_stage_code_idx" ON "service_report_measurements"("stage_code");

-- CreateIndex
CREATE INDEX "service_reports_report_type_code_idx" ON "service_reports"("report_type_code");

-- AddForeignKey
ALTER TABLE "service_reports" ADD CONSTRAINT "service_reports_report_type_code_fkey" FOREIGN KEY ("report_type_code") REFERENCES "service_report_types"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_report_technicians" ADD CONSTRAINT "service_report_technicians_service_report_id_fkey" FOREIGN KEY ("service_report_id") REFERENCES "service_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_report_technicians" ADD CONSTRAINT "service_report_technicians_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_report_equipment_units" ADD CONSTRAINT "service_report_equipment_units_equipment_type_code_fkey" FOREIGN KEY ("equipment_type_code") REFERENCES "equipment_types"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_report_equipment_units" ADD CONSTRAINT "service_report_equipment_units_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_report_measurements" ADD CONSTRAINT "service_report_measurements_equipment_unit_id_fkey" FOREIGN KEY ("equipment_unit_id") REFERENCES "service_report_equipment_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_report_measurements" ADD CONSTRAINT "service_report_measurements_stage_code_fkey" FOREIGN KEY ("stage_code") REFERENCES "measurement_stages"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
