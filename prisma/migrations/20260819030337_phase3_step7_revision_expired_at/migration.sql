-- Phase 3 Step 7 — Approval / Submission / Rejection / Send / Decision
-- Workflow. Adds QuotationRevision.expiredAt (decision B1): every other
-- lifecycle transition (submit, approve, reject, send, customer decision)
-- already had its own dedicated timestamp column — submitted_at, approved_at,
-- rejected_at, sent_at, customer_decision_at — but EXPIRED had none. This
-- closes that gap so "when did this revision expire" is a fast denormalized
-- fact, consistent with the other five transitions, rather than something
-- only recoverable via a join into audit_logs.
--
-- Purely additive and nullable — quotation_revisions already has rows from
-- Steps 5/6 testing, none of which are EXPIRED, so this column starts NULL
-- for all of them, no data migration needed. No Phase 1, Phase 2, or Phase 3
-- Steps 1-6 table, column, grant, or constraint is touched.

-- AlterTable
ALTER TABLE "quotation_revisions" ADD COLUMN     "expired_at" TIMESTAMP(3);
