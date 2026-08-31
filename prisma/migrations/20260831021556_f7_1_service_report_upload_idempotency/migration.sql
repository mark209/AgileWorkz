-- CreateEnum
CREATE TYPE "IdempotencyKeyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "service_report_upload_idempotency_keys" (
    "id" TEXT NOT NULL,
    "idempotency_key" VARCHAR(100) NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "status" "IdempotencyKeyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "service_report_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_report_upload_idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_report_upload_idempotency_keys_service_report_id_key" ON "service_report_upload_idempotency_keys"("service_report_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_report_upload_idempotency_keys_uploaded_by_idempote_key" ON "service_report_upload_idempotency_keys"("uploaded_by", "idempotency_key");

-- AddForeignKey
ALTER TABLE "service_report_upload_idempotency_keys" ADD CONSTRAINT "service_report_upload_idempotency_keys_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_report_upload_idempotency_keys" ADD CONSTRAINT "service_report_upload_idempotency_keys_service_report_id_fkey" FOREIGN KEY ("service_report_id") REFERENCES "service_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
