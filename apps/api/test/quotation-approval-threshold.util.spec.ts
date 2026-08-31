import { Prisma } from "@prisma/client";
import { isOverApprovalThreshold } from "../src/modules/quotations/quotation-approval-threshold.util";

const { Decimal } = Prisma;
const d = (v: string | number) => new Decimal(v);

// Seeded Phase 1 values: quotation_approval_threshold_php = 50000,
// quotation_discount_threshold_pct = 10. Boundary cases matter here — the
// Rev 7 blueprint's wording is "<= threshold = standard; above = requires
// approval", so exactly-at-threshold must NOT require approval.
describe("isOverApprovalThreshold", () => {
  const approvalThresholdPhp = "50000";
  const discountThresholdPct = "10";

  it("is not over threshold when both amount and discount are well under", () => {
    expect(isOverApprovalThreshold(d(10000), d(5), approvalThresholdPhp, discountThresholdPct)).toBe(false);
  });

  it("is not over threshold when total amount is exactly at the threshold", () => {
    expect(isOverApprovalThreshold(d(50000), d(0), approvalThresholdPhp, discountThresholdPct)).toBe(false);
  });

  it("is not over threshold when discount percent is exactly at the threshold", () => {
    expect(isOverApprovalThreshold(d(1000), d(10), approvalThresholdPhp, discountThresholdPct)).toBe(false);
  });

  it("is over threshold when total amount is one centavo over, discount fine", () => {
    expect(isOverApprovalThreshold(d(50000.01), d(0), approvalThresholdPhp, discountThresholdPct)).toBe(true);
  });

  it("is over threshold when discount percent is fractionally over, amount fine", () => {
    expect(isOverApprovalThreshold(d(1000), d(10.01), approvalThresholdPhp, discountThresholdPct)).toBe(true);
  });

  it("is over threshold when both amount and discount exceed their thresholds", () => {
    expect(isOverApprovalThreshold(d(75000), d(15), approvalThresholdPhp, discountThresholdPct)).toBe(true);
  });

  it("is over threshold when only amount exceeds, even with zero discount", () => {
    expect(isOverApprovalThreshold(d(999999), d(0), approvalThresholdPhp, discountThresholdPct)).toBe(true);
  });
});
