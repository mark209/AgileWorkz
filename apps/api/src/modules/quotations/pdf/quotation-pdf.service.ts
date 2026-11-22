import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { renderToBuffer } from "@react-pdf/renderer";
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
        quotation: { include: {
          customer: { include: { contacts: { where: { isPrimary: true, status: "ACTIVE" }, orderBy: { createdAt: "asc" }, take: 1 } } },
          site: { include: { primaryContact: true } },
          inquiry: { include: { contact: true } },
        } },
        createdByUser: { select: { fullName: true } },
        testingCommissioningItems: { where: { included: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
        maintenanceDetails: true,
        lineItems: {
          orderBy: { sortOrder: "asc" },
          select: {
            description: true, specification: true, brand: true, model: true,
            quantity: true, unit: true, unitPrice: true, lineAmount: true, lineFinalAmount: true,
            lineVatAmount: true, taxTreatment: true,
          },
        },
        managerApprovedByUser: { select: { fullName: true } },
        ownerApprovedByUser: { select: { fullName: true } },
      },
    });
    if (!revision || revision.quotationId !== quotationId) {
      throw new NotFoundException("Quotation revision not found");
    }
    if (!revision.approvedAt) {
      throw new ForbiddenException("The quotation PDF is available only after final approval");
    }

    // Approval remains valid when the same revision later becomes SENT,
    // ACCEPTED, DECLINED, EXPIRED or SUPERSEDED. Its approval timestamp is
    // retained; the current lifecycle status alone cannot identify a draft.
    const isFinal = revision.approvedAt !== null;

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
      lineAmount: li.lineAmount.toString(),
      lineFinalAmount: li.lineFinalAmount.toString(),
      lineVatAmount: li.lineVatAmount.toString(),
      taxTreatment: li.taxTreatment,
    }));

    const element = buildQuotationPdfDocument({
      quotationNumber: revision.quotation.quotationNumber,
      revisionNumber: revision.revisionNumber,
      customerName: revision.quotation.customer.name,
      siteLabel: revision.quotation.site.label,
      siteAddress: revision.quotation.site.addressLine,
      scopeOfWork: revision.scopeOfWork,
      quotationType: revision.quotation.quotationType,
      pdfLayout: revision.pdfLayout,
      quotationDate: revision.createdAt.toISOString(),
      recipientName: revision.recipientName?.trim() || revision.quotation.inquiry?.contact?.fullName || revision.quotation.site.primaryContact?.fullName || revision.quotation.customer.contacts[0]?.fullName || null,
      preparedByName: revision.preparedByName?.trim() || revision.createdByUser?.fullName || null,
      paymentInstructions: revision.paymentInstructions,
      scopeTitle: revision.scopeChecklistTitle,
      maintenanceFrequency: revision.maintenanceDetails?.frequency ?? null,
      scopeItems: revision.testingCommissioningItems.map((item) => ({ description: item.description, method: item.method, indications: item.indications })),
      notes: revision.notes,
      lineItems,
      subtotal: revision.subtotal.toString(),
      discountAmount: revision.discountAmount.toString(),
      netAmount: revision.netAmount.toString(),
      vatAmount: revision.vatAmount.toString(),
      totalAmount: revision.totalAmount.toString(),
      termsAndConditions: revision.termsAndConditions,
      paymentTerms: revision.paymentTerms,
      warranty: revision.warranty,
      leadTime: revision.leadTime,
      exclusions: revision.exclusions,
      validUntil: revision.validUntil?.toISOString() ?? null,
      isFinal,
      approvals,
      generatedAt: new Date().toISOString(),
    });

    return renderToBuffer(element);
  }
}
