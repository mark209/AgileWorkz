import { Injectable, NotFoundException } from "@nestjs/common";
import { renderToBuffer } from "@react-pdf/renderer";
import { QuotationRevisionStatus } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { buildQuotationPdfDocument, QuotationPdfApprovalEvent, QuotationPdfLineItem } from "./quotation-pdf-document";

// Two-level approval correction — quotation PDF generation. Rendered
// on-demand from live data on every request (never cached/stored), so it
// always reflects the revision's current state. Only customer-safe fields
// are read from QuotationLineItem — unitCostExpense/markupPercent/
// totalInternalCost/grossProfitAmount/grossMarginPercent are internal-only
// per the schema's own comment and are never selected here, let alone
// rendered.
@Injectable()
export class QuotationPdfService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(quotationId: string, revisionId: string): Promise<Buffer> {
    const revision = await this.prisma.quotationRevision.findUnique({
      where: { id: revisionId },
      include: {
        quotation: { include: { customer: true, site: true } },
        lineItems: { orderBy: { sortOrder: "asc" } },
        managerApprovedByUser: { select: { fullName: true } },
        ownerApprovedByUser: { select: { fullName: true } },
      },
    });
    if (!revision || revision.quotationId !== quotationId) {
      throw new NotFoundException("Quotation revision not found");
    }

    // isFinal: APPROVED is only ever reached once every required level for
    // this revision's amount has explicitly approved it — there is no
    // automatic-approval path left that could reach APPROVED any other
    // way, so this single check is sufficient, not a proxy.
    const isFinal = revision.status === QuotationRevisionStatus.APPROVED;

    const approvals: QuotationPdfApprovalEvent[] = [];
    if (isFinal && revision.managerApprovedAt && revision.managerApprovedByUser) {
      approvals.push({
        levelLabel: "Manager",
        approverName: revision.managerApprovedByUser.fullName,
        approverRole: "Manager (Service)",
        approvedAt: revision.managerApprovedAt.toISOString(),
      });
    }
    if (isFinal && revision.ownerApprovedAt && revision.ownerApprovedByUser) {
      approvals.push({
        levelLabel: "Owner",
        approverName: revision.ownerApprovedByUser.fullName,
        approverRole: "Owner",
        approvedAt: revision.ownerApprovedAt.toISOString(),
      });
    }

    const lineItems: QuotationPdfLineItem[] = revision.lineItems.map((li) => ({
      description: li.description,
      specification: li.specification,
      brand: li.brand,
      model: li.model,
      quantity: li.quantity.toString(),
      unit: li.unit,
      unitPrice: li.unitPrice.toString(),
      lineFinalAmount: li.lineFinalAmount.toString(),
    }));

    const element = buildQuotationPdfDocument({
      quotationNumber: revision.quotation.quotationNumber,
      revisionNumber: revision.revisionNumber,
      customerName: revision.quotation.customer.name,
      siteLabel: revision.quotation.site.label,
      siteAddress: revision.quotation.site.addressLine,
      scopeOfWork: revision.scopeOfWork,
      lineItems,
      subtotal: revision.subtotal.toString(),
      discountAmount: revision.discountAmount.toString(),
      netAmount: revision.netAmount.toString(),
      vatAmount: revision.vatAmount.toString(),
      totalAmount: revision.totalAmount.toString(),
      termsAndConditions: revision.termsAndConditions,
      isFinal,
      approvals,
      generatedAt: new Date().toISOString(),
    });

    return renderToBuffer(element);
  }
}
