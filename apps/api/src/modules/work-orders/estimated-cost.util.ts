import { Prisma } from "@prisma/client";
import { round2 } from "../quotations/pricing/revision-pricing.util";

const { Decimal } = Prisma;
type D = InstanceType<typeof Prisma.Decimal>;

export interface CostableLineItem {
  quantity: D;
  unitPriceBeforeVat: D;
  totalInternalCost: D | null;
  grossProfitAmount: D | null;
}

export interface EstimatedCostAggregate {
  estimatedTotalCost: D | null;
  estimatedGrossProfitAmount: D | null;
  estimatedGrossMarginPercent: D | null;
}

/**
 * Read-through snapshot only (approved plan §03) — sums the costing fields
 * Phase 3's own pricing engine already computed and persisted per line item
 * (revision-pricing.util.ts, Step 6), never re-derives them. Lines with no
 * costing entered (unit_cost_expense/markup_percent both absent, so
 * totalInternalCost/grossProfitAmount are both null) are excluded from the
 * aggregate entirely — mixing a costed line's real profit with an uncosted
 * line's zero would understate margin, not represent "unknown". If nothing
 * on the Work Order has costing, every result field is null, not zero — an
 * absent value must never be presented as if it means "no cost".
 */
export function aggregateEstimatedCost(lines: CostableLineItem[]): EstimatedCostAggregate {
  const costed = lines.filter((l) => l.totalInternalCost !== null && l.grossProfitAmount !== null);
  if (costed.length === 0) {
    return { estimatedTotalCost: null, estimatedGrossProfitAmount: null, estimatedGrossMarginPercent: null };
  }

  const estimatedTotalCost = round2(costed.reduce((sum, l) => sum.plus(l.totalInternalCost!), new Decimal(0)));
  const estimatedGrossProfitAmount = round2(
    costed.reduce((sum, l) => sum.plus(l.grossProfitAmount!), new Decimal(0)),
  );
  // Same base revenue-figure convention already used for the per-line margin
  // (unitPriceBeforeVat x quantity — pre-VAT, pre-discount) so this aggregate
  // margin is directly comparable to any of the line-level margins it rolls up.
  const sellingTotal = costed.reduce((sum, l) => sum.plus(l.unitPriceBeforeVat.times(l.quantity)), new Decimal(0));
  const estimatedGrossMarginPercent = sellingTotal.isZero()
    ? null
    : round2(estimatedGrossProfitAmount.dividedBy(sellingTotal).times(100));

  return { estimatedTotalCost, estimatedGrossProfitAmount, estimatedGrossMarginPercent };
}
