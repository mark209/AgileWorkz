import { Prisma } from "@prisma/client";
import { aggregateEstimatedCost, CostableLineItem } from "../src/modules/work-orders/estimated-cost.util";

const { Decimal } = Prisma;
const d = (v: string | number) => new Decimal(v);

// A "costed" line has both totalInternalCost and grossProfitAmount set (the
// Phase 3 pricing engine only ever sets both together — hasCosting is one
// boolean, not two independent nulls). An "uncosted" line has both null.
const costed = (quantity: number, unitPriceBeforeVat: number, totalInternalCost: number, grossProfitAmount: number): CostableLineItem => ({
  quantity: d(quantity),
  unitPriceBeforeVat: d(unitPriceBeforeVat),
  totalInternalCost: d(totalInternalCost),
  grossProfitAmount: d(grossProfitAmount),
});

const uncosted = (quantity: number, unitPriceBeforeVat: number): CostableLineItem => ({
  quantity: d(quantity),
  unitPriceBeforeVat: d(unitPriceBeforeVat),
  totalInternalCost: null,
  grossProfitAmount: null,
});

describe("aggregateEstimatedCost", () => {
  it("returns all-null when there are no line items at all", () => {
    const result = aggregateEstimatedCost([]);
    expect(result.estimatedTotalCost).toBeNull();
    expect(result.estimatedGrossProfitAmount).toBeNull();
    expect(result.estimatedGrossMarginPercent).toBeNull();
  });

  it("returns all-null when every line item has no costing entered", () => {
    const result = aggregateEstimatedCost([uncosted(2, 500), uncosted(1, 1000)]);
    expect(result.estimatedTotalCost).toBeNull();
    expect(result.estimatedGrossProfitAmount).toBeNull();
    expect(result.estimatedGrossMarginPercent).toBeNull();
  });

  it("sums cost and profit across multiple costed lines and derives margin from selling total", () => {
    // Line 1: qty 2 @ unitPriceBeforeVat 1000 -> selling 2000, cost 1200, profit 800
    // Line 2: qty 1 @ unitPriceBeforeVat 500  -> selling 500,  cost 300,  profit 200
    // Totals: cost 1500, profit 1000, selling 2500 -> margin 40%
    const result = aggregateEstimatedCost([costed(2, 1000, 1200, 800), costed(1, 500, 300, 200)]);
    expect(result.estimatedTotalCost?.toString()).toBe("1500");
    expect(result.estimatedGrossProfitAmount?.toString()).toBe("1000");
    expect(result.estimatedGrossMarginPercent?.toString()).toBe("40");
  });

  it("excludes uncosted lines entirely rather than treating their contribution as zero", () => {
    const result = aggregateEstimatedCost([costed(1, 1000, 600, 400), uncosted(5, 2000)]);
    // Only the costed line counts — the uncosted line's 10,000 of selling
    // price must never dilute the margin computed from the costed line alone.
    expect(result.estimatedTotalCost?.toString()).toBe("600");
    expect(result.estimatedGrossProfitAmount?.toString()).toBe("400");
    expect(result.estimatedGrossMarginPercent?.toString()).toBe("40");
  });

  it("rounds the margin to 2 decimal places, half-up", () => {
    // selling 300, cost 100, profit 200 -> 200/300*100 = 66.666...% -> 66.67
    const result = aggregateEstimatedCost([costed(1, 300, 100, 200)]);
    expect(result.estimatedGrossMarginPercent?.toString()).toBe("66.67");
  });
});
