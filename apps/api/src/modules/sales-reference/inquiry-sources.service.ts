import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ActorType, ReferenceStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ActorContext } from "../identity/users.service";
import { CreateInquirySourceDto } from "./dto/create-inquiry-source.dto";

// Same deliberately-narrow scope as trades/capacity_units — list, create,
// status change only. No general update endpoint.
@Injectable()
export class InquirySourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    return this.prisma.inquirySource.findMany({ orderBy: { sortOrder: "asc" } });
  }

  async create(dto: CreateInquirySourceDto, actor: ActorContext) {
    const existing = await this.prisma.inquirySource.findUnique({ where: { code: dto.code } });
    if (existing) {
      throw new ConflictException("An inquiry source with this code already exists");
    }

    const source = await this.prisma.inquirySource.create({
      data: { code: dto.code, label: dto.label, sortOrder: dto.sortOrder ?? 0 },
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "inquiry_source_created",
      entityType: "inquiry_source",
      entityId: source.code,
      afterData: { code: source.code, label: source.label },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return source;
  }

  async updateStatus(code: string, status: ReferenceStatus, actor: ActorContext) {
    const before = await this.findByCodeOrThrow(code);
    const after = await this.prisma.inquirySource.update({ where: { code }, data: { status } });

    // RESTRICT on inquiries.source_code means a source in active use can't
    // be deleted — deactivating it here is the only supported way to retire
    // one, and existing inquiries referencing it are unaffected.
    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "inquiry_source_status_changed",
      entityType: "inquiry_source",
      entityId: code,
      beforeData: { status: before.status },
      afterData: { status: after.status },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  private async findByCodeOrThrow(code: string) {
    const source = await this.prisma.inquirySource.findUnique({ where: { code } });
    if (!source) throw new NotFoundException("Inquiry source not found");
    return source;
  }
}
