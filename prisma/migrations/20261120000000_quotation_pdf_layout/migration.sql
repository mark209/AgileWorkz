ALTER TABLE "quotation_revisions" ADD COLUMN "pdf_layout" VARCHAR(20) NOT NULL DEFAULT 'AUTO';
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_pdf_layout_check"
  CHECK ("pdf_layout" IN ('AUTO', 'STANDARD', 'MAINTENANCE'));
