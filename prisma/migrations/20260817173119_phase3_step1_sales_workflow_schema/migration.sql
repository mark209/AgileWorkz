-- Phase 3 Step 1 — Sales Workflow schema (Inquiries -> Quotations -> Revisions).
-- Purely additive: no Phase 1 or Phase 2 table, column, grant, or constraint
-- is touched by this migration. Generated via `prisma migrate diff`
-- (schema-to-schema, no live database involved) against the approved Phase 3
-- Sales Workflow Plan, Revision 3 (Final) — phase3-plan.html §02/§06/§06a/
-- §06b/§15 — with one hand-added partial unique index at the bottom that
-- Prisma has no declarative attribute for (see note above that statement;
-- same pattern already used for the Phase 2 assets.parent_asset_id CHECK).
--
-- `inquiries` is intentionally not created by this migration — see the
-- Phase 3 section header comment in schema.prisma and the Step 1 report.

-- CreateEnum
CREATE TYPE "QuotationType" AS ENUM ('REPAIR', 'PREVENTIVE_MAINTENANCE', 'SUPPLY_INSTALLATION', 'PROJECT');

-- CreateEnum
CREATE TYPE "QuotationRevisionStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "TaxTreatment" AS ENUM ('VAT_INCLUSIVE', 'VAT_EXEMPT');

-- CreateEnum
CREATE TYPE "MaintenanceFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "MaintenanceBillingFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL', 'PER_VISIT', 'LUMP_SUM');

-- CreateTable
CREATE TABLE "trades" (
    "code" VARCHAR(20) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "ReferenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trades_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "quotation_term_templates" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "quotation_type" "QuotationType",
    "trade_code" VARCHAR(20),
    "body" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "status" "ReferenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotation_term_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotations" (
    "id" TEXT NOT NULL,
    "inquiry_id" TEXT,
    "customer_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "quotation_number" VARCHAR(30) NOT NULL,
    "quotation_type" "QuotationType" NOT NULL,
    "primary_trade_code" VARCHAR(20) NOT NULL,
    "status" "QuotationRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_number_counters" (
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "last_sequence" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotation_number_counters_pkey" PRIMARY KEY ("year","month")
);

-- CreateTable
CREATE TABLE "quotation_revisions" (
    "id" TEXT NOT NULL,
    "quotation_id" TEXT NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "is_current" BOOLEAN NOT NULL,
    "status" "QuotationRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "scope_of_work" TEXT,
    "default_tax_treatment" "TaxTreatment" NOT NULL,
    "vat_rate_percent" DECIMAL(6,2) NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount_percent" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "payment_terms" TEXT,
    "warranty" TEXT,
    "lead_time" TEXT,
    "notes" TEXT,
    "exclusions" TEXT,
    "terms_and_conditions" TEXT,
    "valid_until" DATE,
    "created_by" TEXT,
    "submitted_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "customer_decision_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotation_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_sections" (
    "id" TEXT NOT NULL,
    "quotation_revision_id" TEXT NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "trade_code" VARCHAR(20),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "final_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "quotation_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_line_items" (
    "id" TEXT NOT NULL,
    "quotation_revision_id" TEXT NOT NULL,
    "section_id" TEXT,
    "asset_id" TEXT,
    "description" VARCHAR(255) NOT NULL,
    "specification" TEXT,
    "brand" VARCHAR(100),
    "model" VARCHAR(100),
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" VARCHAR(30) NOT NULL,
    "unit_cost_expense" DECIMAL(14,2),
    "markup_percent" DECIMAL(6,2),
    "unit_price_before_vat" DECIMAL(14,2) NOT NULL,
    "total_internal_cost" DECIMAL(14,2),
    "gross_profit_amount" DECIMAL(14,2),
    "gross_margin_percent" DECIMAL(6,2),
    "tax_treatment" "TaxTreatment" NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "material_amount" DECIMAL(14,2),
    "labor_amount" DECIMAL(14,2),
    "line_amount" DECIMAL(14,2) NOT NULL,
    "line_discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "line_final_amount" DECIMAL(14,2) NOT NULL,
    "line_net_amount" DECIMAL(14,2) NOT NULL,
    "line_vat_amount" DECIMAL(14,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "quotation_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_maintenance_details" (
    "quotation_revision_id" TEXT NOT NULL,
    "contract_period_months" INTEGER NOT NULL,
    "frequency" "MaintenanceFrequency" NOT NULL,
    "scheduled_visits" INTEGER NOT NULL,
    "billing_frequency" "MaintenanceBillingFrequency" NOT NULL,

    CONSTRAINT "quotation_maintenance_details_pkey" PRIMARY KEY ("quotation_revision_id")
);

-- CreateTable
CREATE TABLE "quotation_testing_commissioning_items" (
    "id" TEXT NOT NULL,
    "quotation_revision_id" TEXT NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "quotation_testing_commissioning_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trades_status_idx" ON "trades"("status");

-- CreateIndex
CREATE INDEX "quotation_term_templates_quotation_type_idx" ON "quotation_term_templates"("quotation_type");

-- CreateIndex
CREATE INDEX "quotation_term_templates_trade_code_idx" ON "quotation_term_templates"("trade_code");

-- CreateIndex
CREATE INDEX "quotation_term_templates_status_idx" ON "quotation_term_templates"("status");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_quotation_number_key" ON "quotations"("quotation_number");

-- CreateIndex
CREATE INDEX "quotations_customer_id_idx" ON "quotations"("customer_id");

-- CreateIndex
CREATE INDEX "quotations_site_id_idx" ON "quotations"("site_id");

-- CreateIndex
CREATE INDEX "quotations_inquiry_id_idx" ON "quotations"("inquiry_id");

-- CreateIndex
CREATE INDEX "quotations_primary_trade_code_idx" ON "quotations"("primary_trade_code");

-- CreateIndex
CREATE INDEX "quotations_status_idx" ON "quotations"("status");

-- CreateIndex
CREATE INDEX "quotation_revisions_quotation_id_idx" ON "quotation_revisions"("quotation_id");

-- CreateIndex
CREATE INDEX "quotation_revisions_status_idx" ON "quotation_revisions"("status");

-- CreateIndex
CREATE INDEX "quotation_revisions_created_by_idx" ON "quotation_revisions"("created_by");

-- CreateIndex
CREATE INDEX "quotation_revisions_approved_by_idx" ON "quotation_revisions"("approved_by");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_revisions_quotation_id_revision_number_key" ON "quotation_revisions"("quotation_id", "revision_number");

-- CreateIndex
CREATE INDEX "quotation_sections_quotation_revision_id_idx" ON "quotation_sections"("quotation_revision_id");

-- CreateIndex
CREATE INDEX "quotation_sections_trade_code_idx" ON "quotation_sections"("trade_code");

-- CreateIndex
CREATE INDEX "quotation_line_items_quotation_revision_id_idx" ON "quotation_line_items"("quotation_revision_id");

-- CreateIndex
CREATE INDEX "quotation_line_items_section_id_idx" ON "quotation_line_items"("section_id");

-- CreateIndex
CREATE INDEX "quotation_line_items_asset_id_idx" ON "quotation_line_items"("asset_id");

-- CreateIndex
CREATE INDEX "quotation_testing_commissioning_items_quotation_revision_id_idx" ON "quotation_testing_commissioning_items"("quotation_revision_id");

-- AddForeignKey
ALTER TABLE "quotation_term_templates" ADD CONSTRAINT "quotation_term_templates_trade_code_fkey" FOREIGN KEY ("trade_code") REFERENCES "trades"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_primary_trade_code_fkey" FOREIGN KEY ("primary_trade_code") REFERENCES "trades"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_sections" ADD CONSTRAINT "quotation_sections_quotation_revision_id_fkey" FOREIGN KEY ("quotation_revision_id") REFERENCES "quotation_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_sections" ADD CONSTRAINT "quotation_sections_trade_code_fkey" FOREIGN KEY ("trade_code") REFERENCES "trades"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_line_items" ADD CONSTRAINT "quotation_line_items_quotation_revision_id_fkey" FOREIGN KEY ("quotation_revision_id") REFERENCES "quotation_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_line_items" ADD CONSTRAINT "quotation_line_items_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "quotation_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_line_items" ADD CONSTRAINT "quotation_line_items_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_maintenance_details" ADD CONSTRAINT "quotation_maintenance_details_quotation_revision_id_fkey" FOREIGN KEY ("quotation_revision_id") REFERENCES "quotation_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_testing_commissioning_items" ADD CONSTRAINT "quotation_testing_commissioning_items_quotation_revision_i_fkey" FOREIGN KEY ("quotation_revision_id") REFERENCES "quotation_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-added: exactly one QuotationRevision may have is_current = true per
-- quotation_id at any time (approved plan §05). Prisma has no declarative
-- partial-unique-index attribute (as of the pinned 5.x version), so this is
-- added by hand rather than generated — same treatment as the Phase 2
-- assets.parent_asset_id CHECK constraint. A partial unique index (not a
-- plain unique index) is required specifically because most rows will have
-- is_current = false and there is no uniqueness constraint on those.
CREATE UNIQUE INDEX "quotation_revisions_one_current_per_quotation" ON "quotation_revisions"("quotation_id") WHERE "is_current" = true;
