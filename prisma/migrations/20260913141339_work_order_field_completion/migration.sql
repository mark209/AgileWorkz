-- AlterTable
ALTER TABLE "work_orders" ADD COLUMN     "field_completed_at" TIMESTAMP(3),
ADD COLUMN     "field_completed_by" TEXT;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_field_completed_by_fkey" FOREIGN KEY ("field_completed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

