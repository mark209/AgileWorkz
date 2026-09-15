import { Prisma } from "@prisma/client";

/**
 * Two-level approval correction. Approval routing is based ONLY on the
 * revision's final total amount — discount percentage never affects who
 * must approve (approved business rule, superseding the original Rev 7
 * blueprint's combined amount-OR-discount gate). `<=` the threshold means
 * Manager's approval alone finalizes the revision; `>` means Manager's
 * approval only reaches the intermediate PENDING_OWNER_APPROVAL state, and
 * Owner's own explicit approval is additionally required.
 */
export function requiresOwnerApproval(totalAmount: Prisma.Decimal, approvalThresholdPhp: Prisma.Decimal.Value): boolean {
  return totalAmount.greaterThan(approvalThresholdPhp);
}
