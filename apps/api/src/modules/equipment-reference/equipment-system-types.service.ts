import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ActorType, ReferenceStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ActorContext } from "../identity/users.service";
import { CreateEquipmentSystemTypeDto } from "./dto/create-equipment-system-type.dto";

// Same deliberately-narrow scope as EquipmentTypesService — list, create,
// status change only. No general update endpoint in the approved API surface.
@Injectable()
export class EquipmentSystemTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    return this.prisma.equipmentSystemType.findMany({ orderBy: { sortOrder: "asc" } });
  }

  async create(dto: CreateEquipmentSystemTypeDto, actor: ActorContext) {
    const existing = await this.prisma.equipmentSystemType.findUnique({ where: { code: dto.code } });
    if (existing) {
      throw new ConflictException("An equipment system type with this code already exists");
    }

    const systemType = await this.prisma.equipmentSystemType.create({
      data: { code: dto.code, label: dto.label, sortOrder: dto.sortOrder ?? 0 },
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "equipment_system_type_created",
      entityType: "equipment_system_type",
      entityId: systemType.code,
      afterData: { code: systemType.code, label: systemType.label },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return systemType;
  }

  async updateStatus(code: string, status: ReferenceStatus, actor: ActorContext) {
    const before = await this.findByCodeOrThrow(code);
    const after = await this.prisma.equipmentSystemType.update({ where: { code }, data: { status } });

    // RESTRICT on equipment_systems.system_type_code means a type in active
    // use can't be deleted — deactivating it here is the only supported way
    // to retire one, and existing equipment_systems referencing it are
    // unaffected.
    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "equipment_system_type_status_changed",
      entityType: "equipment_system_type",
      entityId: code,
      beforeData: { status: before.status },
      afterData: { status: after.status },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  private async findByCodeOrThrow(code: string) {
    const systemType = await this.prisma.equipmentSystemType.findUnique({ where: { code } });
    if (!systemType) throw new NotFoundException("Equipment system type not found");
    return systemType;
  }
}
