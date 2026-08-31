import { Prisma, TaxTreatment } from "@prisma/client";
import { calculateRevisionPricing, round2 } from "../src/modules/quotations/pricing/revision-pricing.util";

const { Decimal } = Prisma;
const d = (v: string | number) => new Decimal(v);

// Matches the Step 6 review's worked examples exactly, so the report and
// the implementation are provably the same calculation, not just similarly
// worded.
describe("calculateRevisionPricing", () => {
  it("Example 1 — costed line, VAT_INCLUSIVE, no discount: markup and gross margin are distinct", () => {
    const result = calculateRevisionPricing(
      [
        {
          id: "line-a",
          sortOrder: 0,
          quantity: d(2),
          unitCostExpense: d(6000),
          markupPercent: d(50),
          unitPriceBeforeVatInput: null,
          taxTreatment: TaxTreatment.VAT_INCLUSIVE,
          sectionId: null,
        },
      ],
      d(12),
      d(0),
    );

    const line = result.lines[0];
    expect(line.totalInternalCost!.toString()).toBe("12000");
    expect(line.unitPriceBeforeVat.toString()).toBe("9000");
    expect(line.grossProfitAmount!.toString()).toBe("6000");
    expect(line.grossMarginPercent!.toString()).toBe("33.33");
    expect(line.markupPercent!.toString()).toBe("50"); // input, unchanged — never conflated with margin
    expect(line.unitPrice.toString()).toBe("10080");
    expect(line.lineAmount.toString()).toBe("20160");
    expect(line.lineNetAmount.toString()).toBe("18000");
    expect(line.lineVatAmount.toString()).toBe("2160");
    expect(result.subtotal.toString()).toBe("20160");
    expect(result.totalAmount.toString()).toBe("20160");
  });

  it("Example 2 — VAT_EXEMPT line + revision discount: internal costing is untouched, totals reconcile exactly", () => {
    const result = calculateRevisionPricing(
      [
        {
          id: "line-a",
          sortOrder: 0,
          quantity: d(2),
          unitCostExpense: d(6000),
          markupPercent: d(50),
          unitPriceBeforeVatInput: null,
          taxTreatment: TaxTreatment.VAT_INCLUSIVE,
          sectionId: "sec-1",
        },
        {
          id: "line-b",
          sortOrder: 1,
          quantity: d(1),
          unitCostExpense: null,
          markupPercent: null,
          unitPriceBeforeVatInput: d(4840),
          taxTreatment: TaxTreatment.VAT_EXEMPT,
          sectionId: "sec-1",
        },
      ],
      d(12),
      d(2500),
    );

    expect(result.subtotal.toString()).toBe("25000");
    expect(result.discountAmount.toString()).toBe("2500");
    expect(result.discountPercent.toString()).toBe("10");

    const lineA = result.lines.find((l) => l.id === "line-a")!;
    const lineB = result.lines.find((l) => l.id === "line-b")!;
    expect(lineA.lineDiscountAmount.toString()).toBe("2016");
    expect(lineB.lineDiscountAmount.toString()).toBe("484");
    expect(lineA.lineFinalAmount.toString()).toBe("18144");
    expect(lineB.lineFinalAmount.toString()).toBe("4356");
    expect(lineA.lineNetAmount.toString()).toBe("16200");
    expect(lineA.lineVatAmount.toString()).toBe("1944");
    expect(lineB.lineNetAmount.toString()).toBe("4356");
    expect(lineB.lineVatAmount.toString()).toBe("0");

    expect(result.totalAmount.toString()).toBe("22500");
    expect(result.netAmount.toString()).toBe("20556");
    expect(result.vatAmount.toString()).toBe("1944");
    // Reconciliation: net + vat = total, and subtotal - discount = total, exactly.
    expect(result.netAmount.plus(result.vatAmount).toString()).toBe(result.totalAmount.toString());
    expect(result.subtotal.minus(result.discountAmount).toString()).toBe(result.totalAmount.toString());

    // Internal costing is completely unaffected by the discount (Decision:
    // discounts must not corrupt internal costing).
    expect(lineA.totalInternalCost!.toString()).toBe("12000");
    expect(lineA.grossProfitAmount!.toString()).toBe("6000");
    expect(lineA.grossMarginPercent!.toString()).toBe("33.33");

    const section = result.sections.find((s) => s.sectionId === "sec-1")!;
    expect(section.finalAmount.toString()).toBe("22500");
    expect(section.netAmount.toString()).toBe("20556");
    expect(section.vatAmount.toString()).toBe("1944");
  });

  it("percentage discount and fixed-amount discount produce the same result for an equivalent amount", () => {
    const lines = [
      {
        id: "line-a",
        sortOrder: 0,
        quantity: d(1),
        unitCostExpense: null,
        markupPercent: null,
        unitPriceBeforeVatInput: d(10000),
        taxTreatment: TaxTreatment.VAT_EXEMPT,
        sectionId: null,
      },
    ];
    const viaAmount = calculateRevisionPricing(lines, d(12), d(1000)); // 10% of 10,000
    const viaPercentEquivalent = calculateRevisionPricing(lines, d(12), round2(d(10000).times(0.1)));
    expect(viaAmount.totalAmount.toString()).toBe(viaPercentEquivalent.totalAmount.toString());
    expect(viaAmount.totalAmount.toString()).toBe("9000");
  });

  it("centavo remainder reconciles exactly across unevenly-priced lines (largest-remainder method)", () => {
    // The exact worked example from §06b: A/B/C at 3,333.33 / 3,333.33 /
    // 3,333.34 (subtotal 10,000.00), 10% discount.
    const result = calculateRevisionPricing(
      ["a", "b", "c"].map((id, i) => ({
        id,
        sortOrder: i,
        quantity: d(1),
        unitCostExpense: null,
        markupPercent: null,
        unitPriceBeforeVatInput: i < 2 ? d("3333.33") : d("3333.34"),
        taxTreatment: TaxTreatment.VAT_EXEMPT,
        sectionId: null,
      })),
      d(12),
      d(1000),
    );

    const byId = (id: string) => result.lines.find((l) => l.id === id)!;
    expect(byId("a").lineDiscountAmount.toString()).toBe("333.33");
    expect(byId("b").lineDiscountAmount.toString()).toBe("333.33");
    // C has the largest fractional remainder (.004) and absorbs the 1-centavo bump.
    expect(byId("c").lineDiscountAmount.toString()).toBe("333.34");
    const totalDiscount = result.lines.reduce((sum, l) => sum.plus(l.lineDiscountAmount), new Decimal(0));
    expect(totalDiscount.toString()).toBe("1000");
    expect(result.totalAmount.toString()).toBe("9000");
  });

  it("VAT_INCLUSIVE and VAT_EXEMPT produce the correct final price in each direction (original worked example)", () => {
    const inclusive = calculateRevisionPricing(
      [
        {
          id: "l1",
          sortOrder: 0,
          quantity: d(1),
          unitCostExpense: null,
          markupPercent: null,
          unitPriceBeforeVatInput: d("8928.57"),
          taxTreatment: TaxTreatment.VAT_INCLUSIVE,
          sectionId: null,
        },
      ],
      d(12),
      d(0),
    );
    // 8928.57 * 1.12 = 9999.9984, rounds half-up to 10000.00.
    expect(inclusive.lines[0].unitPrice.toString()).toBe("10000");
    expect(inclusive.lines[0].lineVatAmount.toString()).toBe("1071.43");
    expect(inclusive.lines[0].lineNetAmount.toString()).toBe("8928.57");

    const exempt = calculateRevisionPricing(
      [
        {
          id: "l1",
          sortOrder: 0,
          quantity: d(1),
          unitCostExpense: null,
          markupPercent: null,
          unitPriceBeforeVatInput: d("8928.57"),
          taxTreatment: TaxTreatment.VAT_EXEMPT,
          sectionId: null,
        },
      ],
      d(12),
      d(0),
    );
    expect(exempt.lines[0].unitPrice.toString()).toBe("8928.57");
    expect(exempt.lines[0].lineVatAmount.toString()).toBe("0");
  });

  it("clamps discount_amount to subtotal so total_amount never goes negative", () => {
    const result = calculateRevisionPricing(
      [
        {
          id: "l1",
          sortOrder: 0,
          quantity: d(1),
          unitCostExpense: null,
          markupPercent: null,
          unitPriceBeforeVatInput: d(500),
          taxTreatment: TaxTreatment.VAT_EXEMPT,
          sectionId: null,
        },
      ],
      d(12),
      d(999999), // absurdly large stale discount_amount from before lines shrank
    );
    expect(result.discountAmount.toString()).toBe("500");
    expect(result.totalAmount.toString()).toBe("0");
  });
});
