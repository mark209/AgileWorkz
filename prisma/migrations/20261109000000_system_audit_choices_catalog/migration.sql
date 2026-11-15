CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED');

ALTER TABLE "inquiries" ADD COLUMN "source_other" VARCHAR(80), ADD COLUMN "trade_other" VARCHAR(80), ADD COLUMN "inquiry_type_other" VARCHAR(80);
ALTER TABLE "quotations" ADD COLUMN "quotation_type_other" VARCHAR(80), ADD COLUMN "primary_trade_other" VARCHAR(80);

CREATE TABLE "reference_suggestions" (
    "id" TEXT NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "operational_type" "QuotationType",
    "source_entity_id" TEXT,
    "submitted_by" TEXT,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "target_code" VARCHAR(30),
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reference_suggestions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "reference_suggestions_status_kind_idx" ON "reference_suggestions"("status", "kind");

CREATE TABLE "quotation_line_catalog_items" (
    "id" TEXT NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "specification" TEXT,
    "brand" VARCHAR(100),
    "model" VARCHAR(100),
    "unit" VARCHAR(30) NOT NULL,
    "unit_price_before_vat" DECIMAL(14,2) NOT NULL,
    "tax_treatment" "TaxTreatment" NOT NULL,
    "status" "ReferenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "quotation_line_catalog_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "quotation_line_catalog_items_status_idx" ON "quotation_line_catalog_items"("status");

GRANT SELECT, INSERT, UPDATE ON "reference_suggestions", "quotation_line_catalog_items" TO app_runtime;
ALTER TABLE "reference_suggestions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quotation_line_catalog_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_runtime_access ON "reference_suggestions" FOR ALL TO app_runtime USING (true) WITH CHECK (true);
CREATE POLICY app_runtime_access ON "quotation_line_catalog_items" FOR ALL TO app_runtime USING (true) WITH CHECK (true);
