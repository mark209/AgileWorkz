import { Prisma } from "@prisma/client";
import { requiresOwnerApproval } from "../src/modules/quotations/quotation-approval-threshold.util";

const { Decimal } = Prisma;
const d = (v: string | number) => new Decimal(v);

// Two-level approval correction: approved threshold is ₱50,000, amount-only
// (discount percentage plays no role — verified separately, there is no
// discount parameter on this function at all anymore). Boundary cases
// matter here — "₱0.00 through ₱50,000.00 inclusive" requires Manager
// approval only, so exactly-at-threshold must NOT require Owner approval.
describe("requiresOwnerApproval", () => {
  const approvalThresholdPhp = "50000";

  it("does not require Owner approval when well under the threshold", () => {
    expect(requiresOwnerApproval(d(10000), approvalThresholdPhp)).toBe(false);
  });

  it("does not require Owner approval at ₱49,999.99 (one centavo under)", () => {
    expect(requiresOwnerApproval(d(49999.99), approvalThresholdPhp)).toBe(false);
  });

  it("does not require Owner approval at exactly ₱50,000.00 (inclusive boundary)", () => {
    expect(requiresOwnerApproval(d(50000), approvalThresholdPhp)).toBe(false);
  });

  it("requires Owner approval at ₱50,000.01 (one centavo over)", () => {
    expect(requiresOwnerApproval(d(50000.01), approvalThresholdPhp)).toBe(true);
  });

  it("requires Owner approval when well over the threshold", () => {
    expect(requiresOwnerApproval(d(500000), approvalThresholdPhp)).toBe(true);
  });
});
