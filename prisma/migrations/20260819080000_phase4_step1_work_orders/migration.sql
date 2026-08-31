-- Phase 4 Step 1 — Operations: Work Orders & Technician Assignment.
-- Reconstructed from the one-line Rev 7 blueprint summary ("Operations —
-- work orders, technician assignment"), the approved Phase 1-3 architecture,
-- and Phase 3's own forward-references. Frozen against the approved Phase 4
-- Operations Plan and Decision Review (D1-D10, all resolved).
--
-- 5 new enums, 4 new tables, 2 additive values on existing enums
-- (DocumentRelatedType, NumberSeries). No Phase 1, 2, or 3 table, column,
-- constraint, or grant is touched — purely additive throughout.
--
-- Key design points carried over from the approved plan:
--   D1 — Work Orders trace back to their source quotation via BOTH
--        quotation_id and quotation_revision_id (one Work Order per
--        section/scope, not per whole revision).
--   D2 — COMPLETED and CLOSED are separate, semantically distinct states;
--        closed_at/closed_by are independent columns from completed_at/by.
--   D3 — work_order_assignments is an append-only history table, not a
--        mutable pointer; multiple simultaneously-active rows per Work
--        Order are permitted (a crew). See the hand-added partial unique
--        index below.
--   D5 — cancellation is a request/confirm split: cancellation_requested_*
--        columns are set by Office Staff's request action and never change
--        status by themselves; cancelled_at/by/reason are set only by the
--        actual Manager/Admin-Owner cancel action.
--   D6 — started_at/started_by capture a technician's own self-start
--        action; authorization for that action is verified against
--        work_order_assignments at the service layer, not encoded here.
--   D10 — standalone_reason_type classifies non-quotation Work Orders;
--        estimated_value is a schema-only extension point for a future
--        configurable approval threshold — no threshold logic reads it yet.
--   Costing — work_order_actual_costs.cost_type carries the full approved
--        7-category list (LABOR, MATERIAL, MOBILIZATION, SUBCONTRACTOR,
--        EQUIPMENT_RENTAL, OVERHEAD, OTHER). OVERHEAD is deliberately just
--        another value in this same enum, not a separate mechanism —
--        actual_gross_profit_amount/actual_gross_margin_percent will sum
--        every category except OVERHEAD; actual_net_profit_amount/
--        actual_net_profit_margin_percent will sum all 7. Every actual_*
--        and estimated_* column on work_orders is nullable and unpopulated
--        by anything built in this step — schema-only extension points,
--        per the approved plan's §09/§12. The Phase 3 estimated-cost
--        blended-not-categorized limitation is unchanged and not addressed
--        here — quotation_line_items is not touched by this migration.
--
-- Prisma has no declarative partial-unique-index attribute (as of the
-- pinned 5.22 version) — the same accepted gap already worked around for
-- quotation_revisions.is_current (Phase 3 Step 1) and assets.parent_asset_id
-- (Phase 2). Added by hand below, same pattern.

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkOrderType" AS ENUM ('FROM_QUOTATION', 'STANDALONE');

-- CreateEnum
CREATE TYPE "StandaloneReasonType" AS ENUM ('EMERGENCY', 'WARRANTY', 'CALLBACK', 'INTERNAL', 'OTHER');

-- CreateEnum
CREATE TYPE "WorkOrderTaskStatus" AS ENUM ('PENDING', 'DONE', 'SKIPPED');

-- CreateEnum
CREATE TYPE "WorkOrderCostType" AS ENUM ('LABOR', 'MATERIAL', 'MOBILIZATION', 'SUBCONTRACTOR', 'EQUIPMENT_RENTAL', 'OVERHEAD', 'OTHER');

-- AlterEnum
ALTER TYPE "DocumentRelatedType" ADD VALUE 'WORK_ORDER';

-- AlterEnum
ALTER TYPE "NumberSeries" ADD VALUE 'WORK_ORDER';

-- CreateTable
CREATE TABLE "work_orders" (
    "id" TEXT NOT NULL,
    "work_order_number" VARCHAR(30) NOT NULL,
    "customer_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "quotation_id" TEXT,
    "quotation_revision_id" TEXT,
    "work_order_type" "WorkOrderType" NOT NULL,
    "standalone_reason" TEXT,
    "standalone_reason_type" "StandaloneReasonType",
    "estimated_value" DECIMAL(14,2),
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduled_date" DATE,
    "description" TEXT,
    "estimated_total_cost" DECIMAL(14,2),
    "estimated_gross_profit_amount" DECIMAL(14,2),
    "estimated_gross_margin_percent" DECIMAL(6,2),
    "actual_total_cost" DECIMAL(14,2),
    "actual_gross_profit_amount" DECIMAL(14,2),
    "actual_gross_margin_percent" DECIMAL(6,2),
    "actual_net_profit_amount" DECIMAL(14,2),
    "actual_net_profit_margin_percent" DECIMAL(6,2),
    "created_by" TEXT,
    "started_at" TIMESTAMP(3),
    "started_by" TEXT,
    "completed_at" TIMESTAMP(3),
    "completed_by" TEXT,
    "closed_at" TIMESTAMP(3),
    "closed_by" TEXT,
    "cancellation_requested_at" TIMESTAMP(3),
    "cancellation_requested_by" TEXT,
    "cancellation_requested_reason" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "cancellation_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_assignments" (
    "id" TEXT NOT NULL,
    "work_order_id" TEXT NOT NULL,
    "technician_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by" TEXT,
    "unassigned_at" TIMESTAMP(3),
    "unassigned_by" TEXT,

    CONSTRAINT "work_order_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_tasks" (
    "id" TEXT NOT NULL,
    "work_order_id" TEXT NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "source_testing_item_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "WorkOrderTaskStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "work_order_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_actual_costs" (
    "id" TEXT NOT NULL,
    "work_order_id" TEXT NOT NULL,
    "cost_type" "WorkOrderCostType" NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "quantity" DECIMAL(12,3),
    "unit" VARCHAR(30),
    "unit_cost" DECIMAL(14,2),
    "amount" DECIMAL(14,2),
    "recorded_by" TEXT,
    "recorded_at" TIMESTAMP(3),

    CONSTRAINT "work_order_actual_costs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_work_order_number_key" ON "work_orders"("work_order_number");

-- CreateIndex
CREATE INDEX "work_orders_customer_id_idx" ON "work_orders"("customer_id");

-- CreateIndex
CREATE INDEX "work_orders_site_id_idx" ON "work_orders"("site_id");

-- CreateIndex
CREATE INDEX "work_orders_quotation_id_idx" ON "work_orders"("quotation_id");

-- CreateIndex
CREATE INDEX "work_orders_quotation_revision_id_idx" ON "work_orders"("quotation_revision_id");

-- CreateIndex
CREATE INDEX "work_orders_status_idx" ON "work_orders"("status");

-- CreateIndex
CREATE INDEX "work_orders_created_by_idx" ON "work_orders"("created_by");

-- CreateIndex
CREATE INDEX "work_order_assignments_work_order_id_idx" ON "work_order_assignments"("work_order_id");

-- CreateIndex
CREATE INDEX "work_order_assignments_technician_id_idx" ON "work_order_assignments"("technician_id");

-- D3 — prevents the same technician holding two simultaneously-active
-- assignment rows on the same Work Order. Does NOT limit how many distinct
-- technicians can be simultaneously active on one Work Order (that's the
-- whole point of team assignment) — only that any one (work_order_id,
-- technician_id) pair has at most one row with unassigned_at IS NULL at a
-- time. Hand-added; Prisma has no declarative partial-unique attribute.
CREATE UNIQUE INDEX "work_order_assignments_active_technician_key"
    ON "work_order_assignments"("work_order_id", "technician_id")
    WHERE "unassigned_at" IS NULL;

-- CreateIndex
CREATE INDEX "work_order_tasks_work_order_id_idx" ON "work_order_tasks"("work_order_id");

-- CreateIndex
CREATE INDEX "work_order_actual_costs_work_order_id_idx" ON "work_order_actual_costs"("work_order_id");

-- CreateIndex
CREATE INDEX "work_order_actual_costs_cost_type_idx" ON "work_order_actual_costs"("cost_type");

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_quotation_revision_id_fkey" FOREIGN KEY ("quotation_revision_id") REFERENCES "quotation_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_started_by_fkey" FOREIGN KEY ("started_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_cancellation_requested_by_fkey" FOREIGN KEY ("cancellation_requested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignments_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignments_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignments_unassigned_by_fkey" FOREIGN KEY ("unassigned_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_tasks" ADD CONSTRAINT "work_order_tasks_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_tasks" ADD CONSTRAINT "work_order_tasks_source_testing_item_id_fkey" FOREIGN KEY ("source_testing_item_id") REFERENCES "quotation_testing_commissioning_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_actual_costs" ADD CONSTRAINT "work_order_actual_costs_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_actual_costs" ADD CONSTRAINT "work_order_actual_costs_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
