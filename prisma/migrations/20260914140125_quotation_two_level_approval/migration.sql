-- AlterEnum
ALTER TYPE "QuotationRevisionStatus" ADD VALUE 'PENDING_OWNER_APPROVAL';

-- AlterTable
ALTER TABLE "quotation_revisions" ADD COLUMN     "manager_approved_at" TIMESTAMP(3),
ADD COLUMN     "manager_approved_by" TEXT,
ADD COLUMN     "owner_approved_at" TIMESTAMP(3),
ADD COLUMN     "owner_approved_by" TEXT;

-- AddForeignKey
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_manager_approved_by_fkey" FOREIGN KEY ("manager_approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_owner_approved_by_fkey" FOREIGN KEY ("owner_approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

