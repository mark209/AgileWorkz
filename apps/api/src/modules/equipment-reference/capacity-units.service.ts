import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ActorType, ReferenceStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ActorContext } from "../identity/users.service";
import { CreateCapacityUnitDto } from "./dto/create-capacity-unit.dto";

// Same deliberately-narrow scope as EquipmentTypesService/EquipmentSystem-
// TypesService — list, create, status change only. No general update
// endpoint in the approved API surface.
@Injectable()
export class CapacityUnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    return this.prisma.capacityUnit.findMany({ orderBy: { sortOrder: "asc" } });
  }

  async create(dto: CreateCapacityUnitDto, actor: ActorContext) {
    const existing = await this.prisma.capacityUnit.findUnique({ where: { code: dto.code } });
    if (existing) {
      throw new ConflictException("A capacity unit with this code already exists");
    }

    const capacityUnit = await this.prisma.capacityUnit.create({
      data: { code: dto.code, label: dto.label, sortOrder: dto.sortOrder ?? 0 },
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "capacity_unit_created",
      entityType: "capacity_unit",
      entityId: capacityUnit.code,
      afterData: { code: capacityUnit.code, label: capacityUnit.label },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return capacityUnit;
  }

  async updateStatus(code: string, status: ReferenceStatus, actor: ActorContext) {
    const before = await this.findByCodeOrThrow(code);
    const after = await this.prisma.capacityUnit.update({ where: { code }, data: { status } });

    // RESTRICT on assets.capacity_unit_code means a unit in active use can't
    // be deleted — deactivating it here is the only supported way to retire
    // one, and existing assets referencing it are unaffected.
    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "capacity_unit_status_changed",
      entityType: "capacity_unit",
      entityId: code,
      beforeData: { status: before.status },
      afterData: { status: after.status },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  private async findByCodeOrThrow(code: string) {
    const capacityUnit = await this.prisma.capacityUnit.findUnique({ where: { code } });
    if (!capacityUnit) throw new NotFoundException("Capacity unit not found");
    return capacityUnit;
  }
}
