-- Phase 5 Step 1 correction round 2 — applies Recommendations G, H, I,
-- grounded in a review of all three real Service Report forms (Maintenance
-- Cleaning, General Service/Repair, Installation/Start-up/Testing &
-- Commissioning) on top of the two already-applied Phase 5 Step 1
-- migrations. No Phase 1-4 table is touched. All affected tables were
-- confirmed empty (zero rows) before this migration was written.
--
-- Recommendation G — extends the equipment-unit linkage already applied to
-- service_report_measurements to service_report_problems and
-- service_report_narrative_items (both nullable FK, SET NULL). Evidenced
-- by a defect tied to one specific unit on the General Service Report, and
-- per-unit conditions on the Installation/Commissioning report — problems
-- and findings are frequently equipment-specific, not just report-level,
-- the same fact already established for measurements.
--
-- Recommendation H — problem_types: a controlled, extensible reference
-- table (same pattern as measurement_types/signoff_roles/
-- service_report_types/measurement_stages), with a NULLABLE
-- service_report_problems.problem_type_code (RESTRICT) — nullable,
-- deliberately, unlike the required measurement_type_code/
-- equipment_type_code, so free-text description alone can still capture a
-- finding that doesn't map to any checkbox category ("Others"). Evidenced
-- by the General Service Report's fixed multi-select problem checklist.
-- Left unseeded in this step.
--
-- Recommendation I — service_reports.contact_name / contact_phone
-- (nullable). Appeared on 2 of 3 real forms ("Contact No." / "Contact
-- Person / Tel No.") as the specific on-site contact for that visit,
-- distinct from the customer's own on-file phone (Customer.phone). Free
-- text, no FK to the Phase 2 Contact table — not every on-site contact is
-- necessarily a registered Contact record.

-- AlterTable
ALTER TABLE "service_report_narrative_items" ADD COLUMN     "equipment_unit_id" TEXT;

-- AlterTable
ALTER TABLE "service_report_problems" ADD COLUMN     "equipment_unit_id" TEXT,
ADD COLUMN     "problem_type_code" VARCHAR(40);

-- AlterTable
ALTER TABLE "service_reports" ADD COLUMN     "contact_name" VARCHAR(160),
ADD COLUMN     "contact_phone" VARCHAR(30);

-- CreateTable
CREATE TABLE "problem_types" (
    "code" VARCHAR(40) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "ReferenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "problem_types_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "problem_types_status_idx" ON "problem_types"("status");

-- CreateIndex
CREATE INDEX "service_report_narrative_items_equipment_unit_id_idx" ON "service_report_narrative_items"("equipment_unit_id");

-- CreateIndex
CREATE INDEX "service_report_problems_equipment_unit_id_idx" ON "service_report_problems"("equipment_unit_id");

-- CreateIndex
CREATE INDEX "service_report_problems_problem_type_code_idx" ON "service_report_problems"("problem_type_code");

-- AddForeignKey
ALTER TABLE "service_report_problems" ADD CONSTRAINT "service_report_problems_equipment_unit_id_fkey" FOREIGN KEY ("equipment_unit_id") REFERENCES "service_report_equipment_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_report_problems" ADD CONSTRAINT "service_report_problems_problem_type_code_fkey" FOREIGN KEY ("problem_type_code") REFERENCES "problem_types"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_report_narrative_items" ADD CONSTRAINT "service_report_narrative_items_equipment_unit_id_fkey" FOREIGN KEY ("equipment_unit_id") REFERENCES "service_report_equipment_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
