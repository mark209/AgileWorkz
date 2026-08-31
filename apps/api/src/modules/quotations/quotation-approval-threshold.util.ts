import { Prisma } from "@prisma/client";

/**
 * Step 7 submit-time threshold check. Matches the Rev 7 blueprint's exact
 * original wording: "<= threshold = standard; above = requires Manager
 * approval" — so <= on BOTH dimensions auto-approves, and > on EITHER
 * dimension requires PENDING_APPROVAL. Extracted as a pure function (same
 * pattern as pricing/revision-pricing.util.ts) so the boundary behavior is
 * directly unit-testable without a database.
 */
export function isOverApprovalThreshold(
  totalAmount: Prisma.Decimal,
  discountPercent: Prisma.Decimal,
  approvalThresholdPhp: Prisma.Decimal.Value,
  discountThresholdPct: Prisma.Decimal.Value,
): boolean {
  return totalAmount.greaterThan(approvalThresholdPhp) || discountPercent.greaterThan(discountThresholdPct);
}
