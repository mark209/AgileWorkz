ALTER TABLE "quotation_revisions"
  ADD COLUMN "recipient_name" VARCHAR(160),
  ADD COLUMN "prepared_by_name" VARCHAR(160),
  ADD COLUMN "payment_instructions" TEXT,
  ADD COLUMN "scope_checklist_title" VARCHAR(160);

ALTER TABLE "quotation_testing_commissioning_items"
  ADD COLUMN "method" TEXT,
  ADD COLUMN "indications" TEXT;

ALTER TABLE "work_order_tasks"
  ADD COLUMN "method" TEXT,
  ADD COLUMN "indications" TEXT;
