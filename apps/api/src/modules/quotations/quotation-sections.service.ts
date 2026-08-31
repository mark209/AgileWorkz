import { Injectable, NotFoundException } from "@nestjs/common";
import { ActorType } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ActorContext } from "../identity/users.service";
import { changedKeysOf, pickDefined } from "../../common/diff-fields.util";
import { assertRevisionEditable } from "./revision-lock.util";
import { CreateSectionDto } from "./dto/create-section.dto";
import { UpdateSectionDto } from "./dto/update-section.dto";
import { ReorderSectionsDto } from "./dto/reorder-sections.dto";

// Section create/rename/reorder/delete never triggers QuotationPricingService
// — a section is purely a grouping label with no pricing effect of its own.
// Deleting one only ungroups its line items (ON DELETE SET NULL), it never
// deletes or reprices them.
@Injectable()
export class QuotationSectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(revisionId: string) {
    await this.findRevisionOrThrow(revisionId);
    return this.prisma.quotationSection.findMany({ where: { quotationRevisionId: revisionId }, orderBy: { sortOrder: "asc" } });
  }

  async create(revisionId: string, dto: CreateSectionDto, actor: ActorContext) {
    const revision = await this.findRevisionOrThrow(revisionId);
    assertRevisionEditable(revision);
    if (dto.tradeCode) await this.assertTradeValid(dto.tradeCode);

    const section = await this.prisma.quotationSection.create({
      data: {
        quotationRevisionId: revisionId,
        name: dto.name,
        tradeCode: dto.tradeCode,
        sortOrder: dto.sortOrder ?? (await this.nextSortOrder(revisionId)),
      },
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "section_created",
      entityType: "quotation_section",
      entityId: section.id,
      afterData: { quotationRevisionId: revisionId, name: section.name, tradeCode: section.tradeCode },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return section;
  }

  async update(revisionId: string, sectionId: string, dto: UpdateSectionDto, actor: ActorContext) {
    const revision = await this.findRevisionOrThrow(revisionId);
    assertRevisionEditable(revision);
    const before = await this.findSectionOrThrow(revisionId, sectionId);
    if (dto.tradeCode) await this.assertTradeValid(dto.tradeCode);

    const changedKeys = changedKeysOf(dto);
    const after = await this.prisma.quotationSection.update({ where: { id: sectionId }, data: dto });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "section_updated",
      entityType: "quotation_section",
      entityId: sectionId,
      beforeData: pickDefined(before, changedKeys),
      afterData: pickDefined(after, changedKeys),
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  async remove(revisionId: string, sectionId: string, actor: ActorContext) {
    const revision = await this.findRevisionOrThrow(revisionId);
    assertRevisionEditable(revision);
    const before = await this.findSectionOrThrow(revisionId, sectionId);

    await this.prisma.quotationSection.delete({ where: { id: sectionId } });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "section_deleted",
      entityType: "quotation_section",
      entityId: sectionId,
      beforeData: { name: before.name, quotationRevisionId: revisionId },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }

  async reorder(revisionId: string, dto: ReorderSectionsDto, actor: ActorContext) {
    const revision = await this.findRevisionOrThrow(revisionId);
    assertRevisionEditable(revision);
    const existing = await this.prisma.quotationSection.findMany({
      where: { quotationRevisionId: revisionId },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((s) => s.id));
    const requestedIds = new Set(dto.sectionIds);
    if (existingIds.size !== requestedIds.size || [...existingIds].some((id) => !requestedIds.has(id))) {
      throw new NotFoundException("sectionIds must be exactly the set of this revision's current sections");
    }

    await this.prisma.$transaction(
      dto.sectionIds.map((id, index) =>
        this.prisma.quotationSection.update({ where: { id }, data: { sortOrder: index * 10 } }),
      ),
    );

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "section_updated",
      entityType: "quotation_section",
      entityId: revisionId,
      afterData: { reordered: dto.sectionIds },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return this.list(revisionId);
  }

  private async nextSortOrder(revisionId: string): Promise<number> {
    const last = await this.prisma.quotationSection.findFirst({
      where: { quotationRevisionId: revisionId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    return (last?.sortOrder ?? -10) + 10;
  }

  private async findRevisionOrThrow(revisionId: string) {
    const revision = await this.prisma.quotationRevision.findUnique({ where: { id: revisionId } });
    if (!revision) throw new NotFoundException("Quotation revision not found");
    return revision;
  }

  private async findSectionOrThrow(revisionId: string, sectionId: string) {
    const section = await this.prisma.quotationSection.findUnique({ where: { id: sectionId } });
    if (!section || section.quotationRevisionId !== revisionId) {
      throw new NotFoundException("Section not found");
    }
    return section;
  }

  private async assertTradeValid(tradeCode: string) {
    const exists = await this.prisma.trade.findUnique({ where: { code: tradeCode }, select: { code: true } });
    if (!exists) throw new NotFoundException("Trade not found");
  }
}
