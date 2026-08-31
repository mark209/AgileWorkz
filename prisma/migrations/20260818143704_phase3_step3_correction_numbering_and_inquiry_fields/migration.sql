-- Phase 3 Step 3 CORRECTION — approved after review of the Inquiry model
-- against the Rev 7 blueprint, both Phase 3 planning artifacts, and the
-- Step 3 completion report. Two things changed at your explicit direction:
--
--   1. `quotation_number_counters` (Step 1) is generalized into a shared
--      `document_number_counters` table, keyed by (series, year, month)
--      instead of just (year, month), so INQ-YYYY-MM-NNNNN and
--      QT-YYYY-MM-NNNNN — and any future numbered series (Work Orders) —
--      share one concurrency-safe numbering engine instead of duplicated
--      per-series tables/logic. Approved specifically because this table
--      had zero rows at the time (Step 5's quotation-creation code, the
--      only thing that would ever have written to it, does not exist yet)
--      — DROP + CREATE carries no data-migration risk.
--   2. The Inquiry model (Step 3) gains: inquiryNumber (system-generated,
--      immutable), sourceCode/tradeCode/inquiryTypeCode (two new reference
--      tables + reuse of the existing trades table), customerReferenceNo,
--      preferredServiceDate, and convertedAt. `inquiries` also had zero
--      rows at the time — the new NOT NULL inquiry_number column needs no
--      backfill/default for the same reason.
--
-- No Phase 1 or Phase 2 table, column, grant, or constraint is touched.
-- `DocumentRelatedType` gains one additive enum value (INQUIRY) — existing
-- CUSTOMER/SITE/ASSET rows and values are unaffected.

-- CreateEnum
CREATE TYPE "NumberSeries" AS ENUM ('INQUIRY', 'QUOTATION');

-- AlterEnum
ALTER TYPE "DocumentRelatedType" ADD VALUE 'INQUIRY';

-- AlterTable
ALTER TABLE "inquiries" ADD COLUMN     "converted_at" TIMESTAMP(3),
ADD COLUMN     "customer_reference_no" VARCHAR(100),
ADD COLUMN     "inquiry_number" VARCHAR(30) NOT NULL,
ADD COLUMN     "inquiry_type_code" VARCHAR(30),
ADD COLUMN     "preferred_service_date" DATE,
ADD COLUMN     "source_code" VARCHAR(30),
ADD COLUMN     "trade_code" VARCHAR(20);

-- DropTable
DROP TABLE "quotation_number_counters";

-- CreateTable
CREATE TABLE "document_number_counters" (
    "series" "NumberSeries" NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "last_sequence" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_number_counters_pkey" PRIMARY KEY ("series","year","month")
);

-- CreateTable
CREATE TABLE "inquiry_sources" (
    "code" VARCHAR(30) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "ReferenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inquiry_sources_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "inquiry_types" (
    "code" VARCHAR(30) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "ReferenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inquiry_types_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "inquiry_sources_status_idx" ON "inquiry_sources"("status");

-- CreateIndex
CREATE INDEX "inquiry_types_status_idx" ON "inquiry_types"("status");

-- CreateIndex
CREATE UNIQUE INDEX "inquiries_inquiry_number_key" ON "inquiries"("inquiry_number");

-- CreateIndex
CREATE INDEX "inquiries_source_code_idx" ON "inquiries"("source_code");

-- CreateIndex
CREATE INDEX "inquiries_trade_code_idx" ON "inquiries"("trade_code");

-- CreateIndex
CREATE INDEX "inquiries_inquiry_type_code_idx" ON "inquiries"("inquiry_type_code");

-- AddForeignKey
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_source_code_fkey" FOREIGN KEY ("source_code") REFERENCES "inquiry_sources"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_trade_code_fkey" FOREIGN KEY ("trade_code") REFERENCES "trades"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_inquiry_type_code_fkey" FOREIGN KEY ("inquiry_type_code") REFERENCES "inquiry_types"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
