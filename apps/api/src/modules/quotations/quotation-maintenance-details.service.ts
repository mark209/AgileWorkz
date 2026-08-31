import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ActorType, QuotationType } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ActorContext } from "../identity/users.service";
import { assertRevisionEditable } from "./revision-lock.util";
import { UpdateMaintenanceDetailsDto } from "./dto/update-maintenance-details.dto";

@Injectable()
export class QuotationMaintenanceDetailsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(revisionId: string) {
    await this.findRevisionOrThrow(revisionId);
    return this.prisma.quotationMaintenanceDetails.findUnique({ where: { quotationRevisionId: revisionId } });
  }

  // Upsert — no separate create/delete endpoint. §07: "only ever populated
  // for quotation_type = PREVENTIVE_MAINTENANCE"; §13: "Only valid when
  // quotation_type = PREVENTIVE_MAINTENANCE".
  async upsert(revisionId: string, dto: UpdateMaintenanceDetailsDto, actor: ActorContext) {
    const revision = await this.findRevisionOrThrow(revisionId);
    assertRevisionEditable(revision);
    if (revision.quotation.quotationType !== QuotationType.PREVENTIVE_MAINTENANCE) {
      throw new BadRequestException("Maintenance details only apply to PREVENTIVE_MAINTENANCE quotations");
    }

    const before = await this.prisma.quotationMaintenanceDetails.findUnique({ where: { quotationRevisionId: revisionId } });
    const after = await this.prisma.quotationMaintenanceDetails.upsert({
      where: { quotationRevisionId: revisionId },
      update: dto,
      create: { quotationRevisionId: revisionId, ...dto },
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "maintenance_details_updated",
      entityType: "quotation_maintenance_details",
      entityId: revisionId,
      beforeData: before ?? undefined,
      afterData: after,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  private async findRevisionOrThrow(revisionId: string) {
    const revision = await this.prisma.quotationRevision.findUnique({
      where: { id: revisionId },
      include: { quotation: { select: { quotationType: true } } },
    });
    if (!revision) throw new NotFoundException("Quotation revision not found");
    return revision;
  }
}
