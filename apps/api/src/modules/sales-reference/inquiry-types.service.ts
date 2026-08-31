import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ActorType, ReferenceStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ActorContext } from "../identity/users.service";
import { CreateInquiryTypeDto } from "./dto/create-inquiry-type.dto";

// Same deliberately-narrow scope as trades/capacity_units — list, create,
// status change only. No general update endpoint. Deliberately its own
// table, not coupled to QuotationType — see the Step 3 correction report.
@Injectable()
export class InquiryTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    return this.prisma.inquiryType.findMany({ orderBy: { sortOrder: "asc" } });
  }

  async create(dto: CreateInquiryTypeDto, actor: ActorContext) {
    const existing = await this.prisma.inquiryType.findUnique({ where: { code: dto.code } });
    if (existing) {
      throw new ConflictException("An inquiry type with this code already exists");
    }

    const type = await this.prisma.inquiryType.create({
      data: { code: dto.code, label: dto.label, sortOrder: dto.sortOrder ?? 0 },
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "inquiry_type_created",
      entityType: "inquiry_type",
      entityId: type.code,
      afterData: { code: type.code, label: type.label },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return type;
  }

  async updateStatus(code: string, status: ReferenceStatus, actor: ActorContext) {
    const before = await this.findByCodeOrThrow(code);
    const after = await this.prisma.inquiryType.update({ where: { code }, data: { status } });

    // RESTRICT on inquiries.inquiry_type_code means a type in active use
    // can't be deleted — deactivating it here is the only supported way to
    // retire one, and existing inquiries referencing it are unaffected.
    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "inquiry_type_status_changed",
      entityType: "inquiry_type",
      entityId: code,
      beforeData: { status: before.status },
      afterData: { status: after.status },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  private async findByCodeOrThrow(code: string) {
    const type = await this.prisma.inquiryType.findUnique({ where: { code } });
    if (!type) throw new NotFoundException("Inquiry type not found");
    return type;
  }
}
