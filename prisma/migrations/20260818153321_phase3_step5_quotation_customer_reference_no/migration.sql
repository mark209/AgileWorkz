-- Phase 3 Step 5 — adds Quotation.customerReferenceNo (the customer's own
-- RFQ/PO/reference number), header-level per your explicit instruction: it
-- identifies the customer's request itself, the same category of fact as
-- quotation_number, stable across every revision of the negotiation rather
-- than varying per revision. Additive, nullable — `quotations` has zero
-- rows at the time of this migration (nothing has written to it before
-- Step 5), so this carries no data-migration risk.
--
-- No Phase 1, Phase 2, or Phase 3 Steps 1-4 table, column, grant, or
-- constraint is touched.

-- AlterTable
ALTER TABLE "quotations" ADD COLUMN     "customer_reference_no" VARCHAR(100);
