import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ActorType, InquiryStatus, NumberSeries } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { NumberingService } from "../../common/numbering/numbering.service";
import { ActorContext } from "../identity/users.service";
import { changedKeysOf, pickDefined } from "../../common/diff-fields.util";
import { CreateInquiryDto } from "./dto/create-inquiry.dto";
import { UpdateInquiryDto } from "./dto/update-inquiry.dto";

@Injectable()
export class InquiriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  async findByIdOrThrow(id: string) {
    const inquiry = await this.prisma.inquiry.findUnique({ where: { id } });
    if (!inquiry) throw new NotFoundException("Inquiry not found");
    return inquiry;
  }

  async listForCustomer(customerId: string) {
    await this.assertCustomerExists(customerId);
    return this.prisma.inquiry.findMany({ where: { customerId }, orderBy: { createdAt: "desc" } });
  }

  async create(customerId: string, dto: CreateInquiryDto, actor: ActorContext) {
    await this.assertCustomerExists(customerId);
    if (dto.siteId) await this.assertSiteValid(customerId, dto.siteId);
    if (dto.contactId) await this.assertContactValid(customerId, dto.contactId);
    if (dto.sourceCode) await this.assertSourceValid(dto.sourceCode);
    if (dto.tradeCode) await this.assertTradeValid(dto.tradeCode);
    if (dto.inquiryTypeCode) await this.assertInquiryTypeValid(dto.inquiryTypeCode);

    // The number is generated inside the SAME transaction as the row
    // insert, so a failed create never leaves an issued-then-abandoned
    // number behind — same guarantee as the approved quotation numbering
    // design, now shared via NumberingService (§05a / Step 3 correction).
    const inquiry = await this.prisma.$transaction(async (tx) => {
      const inquiryNumber = await this.numbering.generateNumber(tx, NumberSeries.INQUIRY);
      return tx.inquiry.create({
        data: { ...dto, ...normalizePreferredServiceDate(dto), customerId, createdBy: actor.userId, inquiryNumber },
      });
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "inquiry_created",
      entityType: "inquiry",
      entityId: inquiry.id,
      afterData: { customerId, inquiryNumber: inquiry.inquiryNumber, subject: inquiry.subject, status: inquiry.status },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return inquiry;
  }

  // Editable only while OPEN. CONVERTED is locked because a real quotation
  // now depends on this record's context (approved: editing it after the
  // fact could desync it from the quotation it produced). CLOSED is
  // read-only/archive. Both are terminal, per the approved status rules.
  async update(id: string, dto: UpdateInquiryDto, actor: ActorContext) {
    const before = await this.findByIdOrThrow(id);
    if (before.status !== InquiryStatus.OPEN) {
      throw new BadRequestException("Only an OPEN inquiry can be edited");
    }
    if (dto.siteId) await this.assertSiteValid(before.customerId, dto.siteId);
    if (dto.contactId) await this.assertContactValid(before.customerId, dto.contactId);
    if (dto.sourceCode) await this.assertSourceValid(dto.sourceCode);
    if (dto.tradeCode) await this.assertTradeValid(dto.tradeCode);
    if (dto.inquiryTypeCode) await this.assertInquiryTypeValid(dto.inquiryTypeCode);

    const changedKeys = changedKeysOf(dto);
    const after = await this.prisma.inquiry.update({
      where: { id },
      data: { ...dto, ...normalizePreferredServiceDate(dto) },
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "inquiry_updated",
      entityType: "inquiry",
      entityId: id,
      beforeData: pickDefined(before, changedKeys),
      afterData: pickDefined(after, changedKeys),
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  // Explicit "lost lead" terminal transition, distinct from CONVERTED (which
  // Step 5 sets automatically once a quotation is created from this
  // inquiry — not wired up yet, since quotation creation doesn't exist
  // until then). Gated by the separate inquiries.close permission at the
  // controller (Step 3 correction — was inquiries.update).
  async close(id: string, actor: ActorContext) {
    const before = await this.findByIdOrThrow(id);
    if (before.status !== InquiryStatus.OPEN) {
      throw new BadRequestException("Only an OPEN inquiry can be closed");
    }

    const after = await this.prisma.inquiry.update({
      where: { id },
      data: { status: InquiryStatus.CLOSED, closedAt: new Date() },
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "inquiry_closed",
      entityType: "inquiry",
      entityId: id,
      beforeData: { status: before.status },
      afterData: { status: after.status, closedAt: after.closedAt },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  private async assertCustomerExists(customerId: string) {
    const exists = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!exists) throw new NotFoundException("Customer not found");
  }

  private async assertSiteValid(customerId: string, siteId: string) {
    const site = await this.prisma.site.findUnique({
      where: { id: siteId },
      select: { id: true, customerId: true },
    });
    if (!site) throw new NotFoundException("Site not found");
    if (site.customerId !== customerId) {
      throw new BadRequestException("Site must belong to the same customer as the inquiry");
    }
  }

  private async assertContactValid(customerId: string, contactId: string) {
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
      select: { id: true, customerId: true },
    });
    if (!contact) throw new NotFoundException("Contact not found");
    if (contact.customerId !== customerId) {
      throw new BadRequestException("Contact must belong to the same customer as the inquiry");
    }
  }

  private async assertSourceValid(sourceCode: string) {
    const exists = await this.prisma.inquirySource.findUnique({ where: { code: sourceCode }, select: { code: true } });
    if (!exists) throw new NotFoundException("Inquiry source not found");
  }

  private async assertTradeValid(tradeCode: string) {
    const exists = await this.prisma.trade.findUnique({ where: { code: tradeCode }, select: { code: true } });
    if (!exists) throw new NotFoundException("Trade not found");
  }

  private async assertInquiryTypeValid(inquiryTypeCode: string) {
    const exists = await this.prisma.inquiryType.findUnique({
      where: { code: inquiryTypeCode },
      select: { code: true },
    });
    if (!exists) throw new NotFoundException("Inquiry type not found");
  }
}

// class-validator's @IsDateString() accepts a plain "YYYY-MM-DD" string (the
// DTO's declared shape), but Prisma Client's own runtime validation of a
// @db.Date field requires a full ISO-8601 DateTime, not a bare date — so the
// DTO's string is converted to a real Date right before it reaches Prisma.
// Only returns a key when the DTO actually included the field, so it never
// forces preferredServiceDate into an update() call that didn't touch it.
function normalizePreferredServiceDate(dto: {
  preferredServiceDate?: string;
}): { preferredServiceDate?: Date } {
  if (dto.preferredServiceDate === undefined) return {};
  return { preferredServiceDate: new Date(dto.preferredServiceDate) };
}
