import { Prisma, TaxTreatment } from "@prisma/client";

const { Decimal } = Prisma;
type D = InstanceType<typeof Prisma.Decimal>;

/**
 * C1 (approved): standard round-half-up to 2 decimals for every persisted
 * derived monetary/percentage value. Internal intermediate math may carry
 * higher precision (decimal.js does this by default); this is the boundary
 * applied at each stage before a value is used downstream or stored.
 */
export function round2(value: D | string | number): D {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * The §06b discount-allocation algorithm specifically calls for FLOOR, not
 * round-half-up, at its provisional-share step — that is what guarantees
 * every provisional share undershoots or exactly matches (never overshoots),
 * leaving a remainder that is always a non-negative whole number of
 * centavos for the largest-remainder step to distribute. This is a more
 * specific, already-frozen rule for that one step, not a deviation from C1.
 */
function floor2(value: D): D {
  return value.toDecimalPlaces(2, Decimal.ROUND_DOWN);
}

export interface LineItemPricingInput {
  id: string;
  sortOrder: number;
  quantity: D;
  unitCostExpense: D | null;
  markupPercent: D | null;
  /** Direct entry, used only when unitCostExpense/markupPercent are absent. */
  unitPriceBeforeVatInput: D | null;
  taxTreatment: TaxTreatment;
  sectionId: string | null;
}

export interface LineItemPricingResult {
  id: string;
  sectionId: string | null;
  unitCostExpense: D | null;
  markupPercent: D | null;
  unitPriceBeforeVat: D;
  totalInternalCost: D | null;
  grossProfitAmount: D | null;
  grossMarginPercent: D | null;
  taxTreatment: TaxTreatment;
  unitPrice: D;
  lineAmount: D;
  lineDiscountAmount: D;
  lineFinalAmount: D;
  lineNetAmount: D;
  lineVatAmount: D;
}

export interface SectionPricingResult {
  sectionId: string;
  netAmount: D;
  vatAmount: D;
  finalAmount: D;
}

export interface RevisionPricingResult {
  lines: LineItemPricingResult[];
  sections: SectionPricingResult[];
  subtotal: D;
  discountAmount: D;
  discountPercent: D;
  netAmount: D;
  vatAmount: D;
  totalAmount: D;
}

/**
 * The full Step 6 calculation chain, in one deterministic, DB-free
 * function: internal cost -> markup -> selling price -> VAT -> discount
 * allocation -> re-derived VAT -> revision/section aggregates. Matches
 * §06/§06a/§06b exactly, plus the C1-C4 decisions.
 *
 * `requestedDiscountAmount` is the revision's currently-stored
 * discount_amount (the persistent anchor — see the Step 6 report for why
 * discount_amount, not discount_percent, is the anchor across ordinary
 * line-item recalculation). It is clamped to the freshly-computed subtotal
 * so total_amount can never go negative merely because line items shrank.
 */
export function calculateRevisionPricing(
  lines: LineItemPricingInput[],
  vatRatePercent: D,
  requestedDiscountAmount: D,
): RevisionPricingResult {
  // Stable order for both the discount allocation and its tie-breaking —
  // §06b: "ordered by sort_order then id".
  const ordered = [...lines].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));

  const preDiscount = ordered.map((line) => computeLinePreDiscount(line, vatRatePercent));
  const subtotal = preDiscount.reduce((sum, l) => sum.plus(l.lineAmount), new Decimal(0));

  const discountAmount = Decimal.max(0, Decimal.min(round2(requestedDiscountAmount), subtotal));
  const discountPercent = subtotal.isZero() ? new Decimal(0) : round2(discountAmount.dividedBy(subtotal).times(100));

  const lineDiscounts = allocateDiscount(preDiscount, subtotal, discountAmount);

  const lines_: LineItemPricingResult[] = preDiscount.map((line) => {
    const lineDiscountAmount = lineDiscounts.get(line.id) ?? new Decimal(0);
    const lineFinalAmount = line.lineAmount.minus(lineDiscountAmount);
    const { lineNetAmount, lineVatAmount } = deriveTaxFromFinalAmount(
      lineFinalAmount,
      line.taxTreatment,
      vatRatePercent,
    );
    return {
      id: line.id,
      sectionId: line.sectionId,
      unitCostExpense: line.unitCostExpense,
      markupPercent: line.markupPercent,
      unitPriceBeforeVat: line.unitPriceBeforeVat,
      totalInternalCost: line.totalInternalCost,
      grossProfitAmount: line.grossProfitAmount,
      grossMarginPercent: line.grossMarginPercent,
      taxTreatment: line.taxTreatment,
      unitPrice: line.unitPrice,
      lineAmount: line.lineAmount,
      lineDiscountAmount,
      lineFinalAmount,
      lineNetAmount,
      lineVatAmount,
    };
  });

  const netAmount = lines_.reduce((sum, l) => sum.plus(l.lineNetAmount), new Decimal(0));
  const vatAmount = lines_.reduce((sum, l) => sum.plus(l.lineVatAmount), new Decimal(0));
  const totalAmount = lines_.reduce((sum, l) => sum.plus(l.lineFinalAmount), new Decimal(0));

  const sectionIds = [...new Set(lines_.map((l) => l.sectionId).filter((id): id is string => id !== null))];
  const sections: SectionPricingResult[] = sectionIds.map((sectionId) => {
    const own = lines_.filter((l) => l.sectionId === sectionId);
    return {
      sectionId,
      netAmount: own.reduce((sum, l) => sum.plus(l.lineNetAmount), new Decimal(0)),
      vatAmount: own.reduce((sum, l) => sum.plus(l.lineVatAmount), new Decimal(0)),
      finalAmount: own.reduce((sum, l) => sum.plus(l.lineFinalAmount), new Decimal(0)),
    };
  });

  return { lines: lines_, sections, subtotal, discountAmount, discountPercent, netAmount, vatAmount, totalAmount };
}

interface LinePreDiscount {
  id: string;
  sortOrder: number;
  sectionId: string | null;
  unitCostExpense: D | null;
  markupPercent: D | null;
  unitPriceBeforeVat: D;
  totalInternalCost: D | null;
  grossProfitAmount: D | null;
  grossMarginPercent: D | null;
  taxTreatment: TaxTreatment;
  unitPrice: D;
  lineAmount: D;
}

// §06a: unit_price_before_vat is server-computed from cost + markup when
// both are present, overwriting any client-supplied direct value — an
// already-frozen rule, not an ambiguity. markup_percent (cost-denominated,
// input) and gross_margin_percent (price-denominated, computed) are kept
// as two separate fields with two separate formulas throughout — never
// treated as interchangeable.
function computeLinePreDiscount(line: LineItemPricingInput, vatRatePercent: D): LinePreDiscount {
  const hasCosting = line.unitCostExpense !== null && line.markupPercent !== null;

  const unitPriceBeforeVat = hasCosting
    ? round2(line.unitCostExpense!.times(new Decimal(1).plus(line.markupPercent!.dividedBy(100))))
    : round2(line.unitPriceBeforeVatInput!);

  const totalInternalCost = hasCosting ? round2(line.unitCostExpense!.times(line.quantity)) : null;
  const grossSellingTotal = unitPriceBeforeVat.times(line.quantity);
  const grossProfitAmount = hasCosting ? round2(grossSellingTotal.minus(totalInternalCost!)) : null;
  const grossMarginPercent =
    hasCosting && !grossSellingTotal.isZero() ? round2(grossProfitAmount!.dividedBy(grossSellingTotal).times(100)) : null;

  const unitPrice =
    line.taxTreatment === TaxTreatment.VAT_INCLUSIVE
      ? round2(unitPriceBeforeVat.times(new Decimal(1).plus(vatRatePercent.dividedBy(100))))
      : unitPriceBeforeVat;
  const lineAmount = round2(line.quantity.times(unitPrice));

  return {
    id: line.id,
    sortOrder: line.sortOrder,
    sectionId: line.sectionId,
    unitCostExpense: line.unitCostExpense,
    markupPercent: line.markupPercent,
    unitPriceBeforeVat,
    totalInternalCost,
    grossProfitAmount,
    grossMarginPercent,
    taxTreatment: line.taxTreatment,
    unitPrice,
    lineAmount,
  };
}

// §06b, steps 1-4: floor each proportional share, then award the whole-
// centavo remainder to the lines with the largest fractional part,
// descending, tied-broken by sort_order then id (already applied via the
// `ordered` input array).
function allocateDiscount(lines: LinePreDiscount[], subtotal: D, discountAmount: D): Map<string, D> {
  const result = new Map<string, D>();
  if (discountAmount.isZero() || subtotal.isZero()) {
    for (const line of lines) result.set(line.id, new Decimal(0));
    return result;
  }

  const raw = lines.map((line) => ({
    id: line.id,
    rawShare: discountAmount.times(line.lineAmount).dividedBy(subtotal),
  }));
  const provisional = raw.map((r) => ({ id: r.id, amount: floor2(r.rawShare), fraction: r.rawShare.minus(floor2(r.rawShare)) }));

  const provisionalSum = provisional.reduce((sum, p) => sum.plus(p.amount), new Decimal(0));
  const remainderCentavos = discountAmount.minus(provisionalSum).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();

  const byFractionDesc = [...provisional].sort((a, b) => {
    const cmp = b.fraction.comparedTo(a.fraction);
    if (cmp !== 0) return cmp;
    const lineA = lines.find((l) => l.id === a.id)!;
    const lineB = lines.find((l) => l.id === b.id)!;
    return lineA.sortOrder - lineB.sortOrder || lineA.id.localeCompare(lineB.id);
  });

  const bump = new Set(byFractionDesc.slice(0, Math.max(0, remainderCentavos)).map((p) => p.id));
  for (const p of provisional) {
    result.set(p.id, bump.has(p.id) ? p.amount.plus("0.01") : p.amount);
  }
  return result;
}

// §06b step 6 — mathematically identical whether derived from the
// discounted gross amount (extraction) or from discounting the pre-VAT
// amount and re-adding VAT (forward), since a fixed-percentage discount and
// a fixed-rate VAT commute. Extraction is used here because it only needs
// lineFinalAmount, not a separately-tracked discount fraction.
function deriveTaxFromFinalAmount(
  lineFinalAmount: D,
  taxTreatment: TaxTreatment,
  vatRatePercent: D,
): { lineNetAmount: D; lineVatAmount: D } {
  if (taxTreatment === TaxTreatment.VAT_EXEMPT) {
    return { lineNetAmount: lineFinalAmount, lineVatAmount: new Decimal(0) };
  }
  const lineNetAmount = round2(lineFinalAmount.dividedBy(new Decimal(1).plus(vatRatePercent.dividedBy(100))));
  const lineVatAmount = lineFinalAmount.minus(lineNetAmount);
  return { lineNetAmount, lineVatAmount };
}
