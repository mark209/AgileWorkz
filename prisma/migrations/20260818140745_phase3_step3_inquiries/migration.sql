-- Phase 3 Step 3 — Inquiries (Customer -> Inquiry -> Quotation).
-- Purely additive: no Phase 1, Phase 2, or existing Phase 3 table, column,
-- grant, or constraint is touched, except completing the
-- quotations.inquiry_id FK that Step 1 deliberately left as a plain nullable
-- column (see the Step 1 completion report). Generated via `prisma migrate
-- diff` against the live database.
--
-- The Inquiry field list is a good-faith reconstruction from the domain
-- model (§01), API surface (§13), and audit requirements (§12) sections of
-- the approved Phase 3 plan, Revision 3 — Rev 3's own §02 says only
-- "unchanged from Revision 1" without restating columns, and Revision 1's
-- literal text was not available in this session. See schema.prisma's
-- Inquiry model comment and the Step 3 completion report.

-- CreateEnum
CREATE TYPE "InquiryStatus" AS ENUM ('OPEN', 'CONVERTED', 'CLOSED');

-- CreateTable
CREATE TABLE "inquiries" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "site_id" TEXT,
    "contact_id" TEXT,
    "subject" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "status" "InquiryStatus" NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inquiries_customer_id_idx" ON "inquiries"("customer_id");

-- CreateIndex
CREATE INDEX "inquiries_site_id_idx" ON "inquiries"("site_id");

-- CreateIndex
CREATE INDEX "inquiries_contact_id_idx" ON "inquiries"("contact_id");

-- CreateIndex
CREATE INDEX "inquiries_status_idx" ON "inquiries"("status");

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "inquiries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
