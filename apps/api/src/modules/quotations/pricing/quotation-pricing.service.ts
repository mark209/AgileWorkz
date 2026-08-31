import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { calculateRevisionPricing, LineItemPricingInput } from "./revision-pricing.util";

/**
 * Re-runs the full Step 6 calculation chain for one revision and persists
 * the results — called after every line-item create/update/delete, and
 * whenever the revision's discount input changes. Never called for section
 * create/rename/reorder/delete alone, since those have no pricing effect on
 * their own (a deleted section's lines become unsectioned via the existing
 * ON DELETE SET NULL, not deleted themselves).
 */
@Injectable()
export class QuotationPricingService {
  async recalculate(tx: Prisma.TransactionClient, revisionId: string): Promise<void> {
    const revision = await tx.quotationRevision.findUniqueOrThrow({
      where: { id: revisionId },
      select: { vatRatePercent: true, discountAmount: true },
    });

    const lineRows = await tx.quotationLineItem.findMany({
      where: { quotationRevisionId: revisionId },
      select: {
        id: true,
        sortOrder: true,
        quantity: true,
        unitCostExpense: true,
        markupPercent: true,
        unitPriceBeforeVat: true,
        taxTreatment: true,
        sectionId: true,
      },
    });

    const inputs: LineItemPricingInput[] = lineRows.map((row) => ({
      id: row.id,
      sortOrder: row.sortOrder,
      quantity: row.quantity,
      unitCostExpense: row.unitCostExpense,
      markupPercent: row.markupPercent,
      // Direct-entry fallback: for a costed line this is ignored by the
      // pricing util in favor of cost*markup, so re-using the stored
      // unit_price_before_vat here is safe either way — it's exactly what
      // a non-costed line's "direct input" already is.
      unitPriceBeforeVatInput: row.unitPriceBeforeVat,
      taxTreatment: row.taxTreatment,
      sectionId: row.sectionId,
    }));

    const result = calculateRevisionPricing(inputs, revision.vatRatePercent, revision.discountAmount);

    await Promise.all(
      result.lines.map((line) =>
        tx.quotationLineItem.update({
          where: { id: line.id },
          data: {
            unitPriceBeforeVat: line.unitPriceBeforeVat,
            totalInternalCost: line.totalInternalCost,
            grossProfitAmount: line.grossProfitAmount,
            grossMarginPercent: line.grossMarginPercent,
            unitPrice: line.unitPrice,
            lineAmount: line.lineAmount,
            lineDiscountAmount: line.lineDiscountAmount,
            lineFinalAmount: line.lineFinalAmount,
            lineNetAmount: line.lineNetAmount,
            lineVatAmount: line.lineVatAmount,
          },
        }),
      ),
    );

    // Every section on this revision gets a fresh aggregate — including
    // ones with zero current lines, which must read back to zero rather
    // than keep a stale value from before their last line was removed.
    const allSectionIds = await tx.quotationSection.findMany({
      where: { quotationRevisionId: revisionId },
      select: { id: true },
    });
    const bySectionId = new Map(result.sections.map((s) => [s.sectionId, s]));
    await Promise.all(
      allSectionIds.map(({ id }) => {
        const totals = bySectionId.get(id);
        return tx.quotationSection.update({
          where: { id },
          data: {
            netAmount: totals?.netAmount ?? 0,
            vatAmount: totals?.vatAmount ?? 0,
            finalAmount: totals?.finalAmount ?? 0,
          },
        });
      }),
    );

    await tx.quotationRevision.update({
      where: { id: revisionId },
      data: {
        subtotal: result.subtotal,
        discountAmount: result.discountAmount,
        discountPercent: result.discountPercent,
        netAmount: result.netAmount,
        vatAmount: result.vatAmount,
        totalAmount: result.totalAmount,
      },
    });
  }
}
