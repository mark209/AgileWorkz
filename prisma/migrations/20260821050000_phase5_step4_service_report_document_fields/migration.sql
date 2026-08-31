-- Phase 5 Step 4 (Upload API) — the original uploaded document's storage
-- reference, added directly to service_reports since every row is created
-- BY an upload (no other code path creates one) — these four columns are
-- NOT NULL with no default:
--
-- - document_file_key: the StorageProvider object key. Never returned to an
--   API client — ServiceReportsService's response mapping strips it.
-- - document_mime_type: needed to re-fetch/re-pass the document to the
--   extraction provider on a manual retry, without depending on the
--   original HTTP request's BullMQ job payload still existing.
-- - document_file_name: the original filename — safe to expose to a client
--   (unlike the storage key), useful for a future review UI.
-- - document_file_size: informational.
--
-- Confirmed empty (zero rows) before this migration — no Upload API existed
-- to create any service_reports row until this same increment.

-- AlterTable
ALTER TABLE "service_reports" ADD COLUMN     "document_file_key" VARCHAR(500) NOT NULL,
ADD COLUMN     "document_file_name" VARCHAR(255) NOT NULL,
ADD COLUMN     "document_file_size" INTEGER NOT NULL,
ADD COLUMN     "document_mime_type" VARCHAR(100) NOT NULL;
