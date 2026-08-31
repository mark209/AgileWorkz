import { Injectable, NotFoundException } from "@nestjs/common";
import { ActorType } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ActorContext } from "../identity/users.service";
import { changedKeysOf, pickDefined } from "../../common/diff-fields.util";
import { assertRevisionEditable } from "./revision-lock.util";
import { CreateTestingCommissioningItemDto } from "./dto/create-testing-commissioning-item.dto";
import { UpdateTestingCommissioningItemDto } from "./dto/update-testing-commissioning-item.dto";

@Injectable()
export class QuotationTestingCommissioningItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(revisionId: string) {
    await this.findRevisionOrThrow(revisionId);
    return this.prisma.quotationTestingCommissioningItem.findMany({
      where: { quotationRevisionId: revisionId },
      orderBy: { sortOrder: "asc" },
    });
  }

  async create(revisionId: string, dto: CreateTestingCommissioningItemDto, actor: ActorContext) {
    const revision = await this.findRevisionOrThrow(revisionId);
    assertRevisionEditable(revision);

    const item = await this.prisma.quotationTestingCommissioningItem.create({
      data: {
        quotationRevisionId: revisionId,
        description: dto.description,
        included: dto.included ?? true,
        sortOrder: dto.sortOrder ?? (await this.nextSortOrder(revisionId)),
      },
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "testing_commissioning_item_created",
      entityType: "quotation_testing_commissioning_item",
      entityId: item.id,
      afterData: { quotationRevisionId: revisionId, description: item.description, included: item.included },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return item;
  }

  async update(revisionId: string, itemId: string, dto: UpdateTestingCommissioningItemDto, actor: ActorContext) {
    const revision = await this.findRevisionOrThrow(revisionId);
    assertRevisionEditable(revision);
    const before = await this.findItemOrThrow(revisionId, itemId);

    const changedKeys = changedKeysOf(dto);
    const after = await this.prisma.quotationTestingCommissioningItem.update({ where: { id: itemId }, data: dto });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "testing_commissioning_item_updated",
      entityType: "quotation_testing_commissioning_item",
      entityId: itemId,
      beforeData: pickDefined(before, changedKeys),
      afterData: pickDefined(after, changedKeys),
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  async remove(revisionId: string, itemId: string, actor: ActorContext) {
    const revision = await this.findRevisionOrThrow(revisionId);
    assertRevisionEditable(revision);
    const before = await this.findItemOrThrow(revisionId, itemId);

    await this.prisma.quotationTestingCommissioningItem.delete({ where: { id: itemId } });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "testing_commissioning_item_deleted",
      entityType: "quotation_testing_commissioning_item",
      entityId: itemId,
      beforeData: { description: before.description, quotationRevisionId: revisionId },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }

  private async nextSortOrder(revisionId: string): Promise<number> {
    const last = await this.prisma.quotationTestingCommissioningItem.findFirst({
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

  private async findItemOrThrow(revisionId: string, itemId: string) {
    const item = await this.prisma.quotationTestingCommissioningItem.findUnique({ where: { id: itemId } });
    if (!item || item.quotationRevisionId !== revisionId) {
      throw new NotFoundException("Testing/commissioning item not found");
    }
    return item;
  }
}
