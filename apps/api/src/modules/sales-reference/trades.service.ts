import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ActorType, ReferenceStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ActorContext } from "../identity/users.service";
import { CreateTradeDto } from "./dto/create-trade.dto";

// Same deliberately-narrow scope as capacity_units/equipment_types — list,
// create, status change only. No general update endpoint in the approved
// API surface (§13: "GET/POST /trades · PATCH /trades/:code/status").
@Injectable()
export class TradesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    return this.prisma.trade.findMany({ orderBy: { sortOrder: "asc" } });
  }

  async create(dto: CreateTradeDto, actor: ActorContext) {
    const existing = await this.prisma.trade.findUnique({ where: { code: dto.code } });
    if (existing) {
      throw new ConflictException("A trade with this code already exists");
    }

    const trade = await this.prisma.trade.create({
      data: { code: dto.code, label: dto.label, sortOrder: dto.sortOrder ?? 0 },
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "trade_created",
      entityType: "trade",
      entityId: trade.code,
      afterData: { code: trade.code, label: trade.label },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return trade;
  }

  async updateStatus(code: string, status: ReferenceStatus, actor: ActorContext) {
    const before = await this.findByCodeOrThrow(code);
    const after = await this.prisma.trade.update({ where: { code }, data: { status } });

    // RESTRICT on every trade_code FK (quotations, quotation_sections,
    // quotation_term_templates, inquiries) means a trade in active use can't
    // be deleted — deactivating it here is the only supported way to retire
    // one, and existing rows referencing it are unaffected.
    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "trade_status_changed",
      entityType: "trade",
      entityId: code,
      beforeData: { status: before.status },
      afterData: { status: after.status },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  private async findByCodeOrThrow(code: string) {
    const trade = await this.prisma.trade.findUnique({ where: { code } });
    if (!trade) throw new NotFoundException("Trade not found");
    return trade;
  }
}
