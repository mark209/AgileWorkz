import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ActorType, SuggestionStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";

@Injectable()
export class ReferenceSuggestionsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  listPending() {
    return this.prisma.referenceSuggestion.findMany({ where: { status: SuggestionStatus.PENDING }, orderBy: { createdAt: "asc" } });
  }

  listApprovedQuotationTypes() {
    return this.prisma.referenceSuggestion.findMany({
      where: { kind: "QUOTATION_TYPE", status: SuggestionStatus.APPROVED },
      select: { id: true, label: true, operationalType: true },
      orderBy: { label: "asc" },
    });
  }

  async review(id: string, approved: boolean, code: string | undefined, reviewerId: string) {
    const suggestion = await this.prisma.referenceSuggestion.findUnique({ where: { id } });
    if (!suggestion) throw new NotFoundException("Suggestion not found");
    if (suggestion.status !== SuggestionStatus.PENDING) throw new ConflictException("This suggestion has already been reviewed");
    if (approved && suggestion.kind !== "QUOTATION_TYPE" && !/^[A-Z][A-Z0-9_]{1,29}$/.test(code ?? "")) {
      throw new BadRequestException("Enter a code with 2–30 uppercase letters, numbers, or underscores");
    }
    if (suggestion.kind === "TRADE" && (code?.length ?? 0) > 20) throw new BadRequestException("Trade code must be 20 characters or fewer");

    return this.prisma.$transaction(async (tx) => {
      if (approved && code) {
        const exists = suggestion.kind === "TRADE" ? await tx.trade.findUnique({ where: { code } })
          : suggestion.kind === "INQUIRY_SOURCE" ? await tx.inquirySource.findUnique({ where: { code } })
          : suggestion.kind === "INQUIRY_TYPE" ? await tx.inquiryType.findUnique({ where: { code } }) : null;
        if (exists) throw new ConflictException("This code is already in use");
      }
      if (approved && suggestion.kind !== "QUOTATION_TYPE") {
        const duplicateLabel = suggestion.kind === "TRADE" ? await tx.trade.findFirst({ where: { label: { equals: suggestion.label, mode: "insensitive" } } })
          : suggestion.kind === "INQUIRY_SOURCE" ? await tx.inquirySource.findFirst({ where: { label: { equals: suggestion.label, mode: "insensitive" } } })
          : await tx.inquiryType.findFirst({ where: { label: { equals: suggestion.label, mode: "insensitive" } } });
        if (duplicateLabel) throw new ConflictException("This choice already exists in the shared list");
      }
      if (approved && suggestion.kind === "QUOTATION_TYPE") {
        const duplicate = await tx.referenceSuggestion.findFirst({ where: {
          id: { not: id }, kind: "QUOTATION_TYPE", status: SuggestionStatus.APPROVED,
          label: { equals: suggestion.label, mode: "insensitive" }, operationalType: suggestion.operationalType,
        } });
        if (duplicate) throw new ConflictException("This quotation type has already been approved");
      }
      const guarded = await tx.referenceSuggestion.updateMany({
        where: { id, status: SuggestionStatus.PENDING },
        data: { status: approved ? SuggestionStatus.APPROVED : SuggestionStatus.DECLINED, reviewedBy: reviewerId, reviewedAt: new Date(), targetCode: approved ? code ?? null : null },
      });
      if (!guarded.count) throw new ConflictException("This suggestion has already been reviewed");
      if (approved) {
        if (suggestion.kind === "TRADE") await tx.trade.create({ data: { code: code!, label: suggestion.label } });
        else if (suggestion.kind === "INQUIRY_SOURCE") await tx.inquirySource.create({ data: { code: code!, label: suggestion.label } });
        else if (suggestion.kind === "INQUIRY_TYPE") await tx.inquiryType.create({ data: { code: code!, label: suggestion.label } });
      }
      await this.audit.write({
        actorType: ActorType.USER, actorUserId: reviewerId,
        action: approved ? "reference_suggestion_approved" : "reference_suggestion_declined",
        entityType: "reference_suggestion", entityId: id,
        beforeData: { status: SuggestionStatus.PENDING },
        afterData: { status: approved ? SuggestionStatus.APPROVED : SuggestionStatus.DECLINED, code: approved ? code : null },
      }, tx);
      return tx.referenceSuggestion.findUniqueOrThrow({ where: { id } });
    });
  }
}
