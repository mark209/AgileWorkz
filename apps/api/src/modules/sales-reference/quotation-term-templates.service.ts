import { Injectable, NotFoundException } from "@nestjs/common";
import { ActorType, ReferenceStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ActorContext } from "../identity/users.service";
import { CreateQuotationTermTemplateDto } from "./dto/create-quotation-term-template.dto";

// "Managed like every Phase 2 reference table — list/create/deactivate"
// (approved plan §08). No general update endpoint: a template's body is
// copied onto a revision at creation time and never edited in place once in
// use — editing history would require a new template row, not mutating an
// existing one.
@Injectable()
export class QuotationTermTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    return this.prisma.quotationTermTemplate.findMany({ orderBy: { name: "asc" } });
  }

  async create(dto: CreateQuotationTermTemplateDto, actor: ActorContext) {
    if (dto.tradeCode) await this.assertTradeValid(dto.tradeCode);

    const template = await this.prisma.quotationTermTemplate.create({
      data: {
        name: dto.name,
        quotationType: dto.quotationType,
        tradeCode: dto.tradeCode,
        body: dto.body,
        isDefault: dto.isDefault ?? false,
      },
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "quotation_term_template_created",
      entityType: "quotation_term_template",
      entityId: template.id,
      afterData: {
        name: template.name,
        quotationType: template.quotationType,
        tradeCode: template.tradeCode,
        isDefault: template.isDefault,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return template;
  }

  async updateStatus(id: string, status: ReferenceStatus, actor: ActorContext) {
    const before = await this.findByIdOrThrow(id);
    const after = await this.prisma.quotationTermTemplate.update({ where: { id }, data: { status } });

    // Deactivating a template never touches any revision that already
    // copied its body — same independent-status principle used everywhere
    // else in Phase 2/3.
    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "quotation_term_template_status_changed",
      entityType: "quotation_term_template",
      entityId: id,
      beforeData: { status: before.status },
      afterData: { status: after.status },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  private async findByIdOrThrow(id: string) {
    const template = await this.prisma.quotationTermTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException("Quotation term template not found");
    return template;
  }

  private async assertTradeValid(tradeCode: string) {
    const exists = await this.prisma.trade.findUnique({ where: { code: tradeCode }, select: { code: true } });
    if (!exists) throw new NotFoundException("Trade not found");
  }
}
