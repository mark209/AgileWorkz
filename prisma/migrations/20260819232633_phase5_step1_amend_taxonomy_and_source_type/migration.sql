-- Phase 5 Step 1 amendment — applies your two post-review decisions on top
-- of the already-applied 20260819165337_phase5_step1_service_reports
-- migration. No Phase 1-4 table is touched; both affected Phase 5 tables
-- (service_report_measurements, service_report_signoffs) and
-- service_reports.source_type were confirmed empty (zero rows) before this
-- migration was written, so the destructive-looking DROP COLUMN/ADD COLUMN
-- NOT NULL steps below carry no real data-loss risk.
--
-- Decision 1 — controlled taxonomy with flexible values. measurement_type
-- and signoff_role become FK references to two new reference tables
-- (measurement_types, signoff_roles), identical in shape to the existing
-- CapacityUnit/EquipmentType pattern (code/label/status/sort_order,
-- extended later by seeding a row, never a migration). Both tables are
-- deliberately left EMPTY by this migration — no exhaustive HVAC taxonomy
-- is being invented in Step 1, same "no initial list approved yet"
-- precedent as inquiry_types (Phase 3). Every other canonical field
-- (measurement value/unit, narrative/problem descriptions, signatory name)
-- stays free text, per the explicit instruction not to over-constrain
-- naturally variable technical data.
--
-- Decision 2 — dedicated Service Report source classification.
-- ServiceReportSourceType's value set is replaced outright (not extended)
-- with an independently-designed set that does not reuse
-- WorkOrder.StandaloneReasonType's values: WORK_ORDER_LINKED,
-- EMERGENCY_CALL, WARRANTY_SERVICE, CALLBACK_VISIT, INTERNAL_SERVICE,
-- OTHER. service_reports.source_type's nullability/requiredness is
-- unchanged — still nullable, still app-validated-required only when
-- work_order_id is null.

-- AlterEnum
BEGIN;
CREATE TYPE "ServiceReportSourceType_new" AS ENUM ('WORK_ORDER_LINKED', 'EMERGENCY_CALL', 'WARRANTY_SERVICE', 'CALLBACK_VISIT', 'INTERNAL_SERVICE', 'OTHER');
ALTER TABLE "service_reports" ALTER COLUMN "source_type" TYPE "ServiceReportSourceType_new" USING ("source_type"::text::"ServiceReportSourceType_new");
ALTER TYPE "ServiceReportSourceType" RENAME TO "ServiceReportSourceType_old";
ALTER TYPE "ServiceReportSourceType_new" RENAME TO "ServiceReportSourceType";
DROP TYPE "ServiceReportSourceType_old";
COMMIT;

-- AlterTable
ALTER TABLE "service_report_measurements" DROP COLUMN "measurement_type",
ADD COLUMN     "measurement_type_code" VARCHAR(40) NOT NULL;

-- AlterTable
ALTER TABLE "service_report_signoffs" DROP COLUMN "signoff_role",
ADD COLUMN     "signoff_role_code" VARCHAR(40) NOT NULL;

-- CreateTable
CREATE TABLE "measurement_types" (
    "code" VARCHAR(40) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "ReferenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "measurement_types_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "signoff_roles" (
    "code" VARCHAR(40) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "ReferenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signoff_roles_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "measurement_types_status_idx" ON "measurement_types"("status");

-- CreateIndex
CREATE INDEX "signoff_roles_status_idx" ON "signoff_roles"("status");

-- CreateIndex
CREATE INDEX "service_report_measurements_measurement_type_code_idx" ON "service_report_measurements"("measurement_type_code");

-- CreateIndex
CREATE INDEX "service_report_signoffs_signoff_role_code_idx" ON "service_report_signoffs"("signoff_role_code");

-- AddForeignKey
ALTER TABLE "service_report_measurements" ADD CONSTRAINT "service_report_measurements_measurement_type_code_fkey" FOREIGN KEY ("measurement_type_code") REFERENCES "measurement_types"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_report_signoffs" ADD CONSTRAINT "service_report_signoffs_signoff_role_code_fkey" FOREIGN KEY ("signoff_role_code") REFERENCES "signoff_roles"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
