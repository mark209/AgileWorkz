import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ActorType, ReferenceStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ActorContext } from "../identity/users.service";
import { CreateEquipmentTypeDto } from "./dto/create-equipment-type.dto";

// Deliberately not a full CRUD service — same shape as capacity_units in the
// approved plan: list, create, and status change only. No general update
// endpoint (e.g. correcting a label) was part of the approved API surface,
// so none exists here — see the Step 5 report for this scope note.
@Injectable()
export class EquipmentTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    return this.prisma.equipmentType.findMany({ orderBy: { sortOrder: "asc" } });
  }

  async create(dto: CreateEquipmentTypeDto, actor: ActorContext) {
    const existing = await this.prisma.equipmentType.findUnique({ where: { code: dto.code } });
    if (existing) {
      throw new ConflictException("An equipment type with this code already exists");
    }

    const equipmentType = await this.prisma.equipmentType.create({
      data: { code: dto.code, label: dto.label, sortOrder: dto.sortOrder ?? 0 },
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "equipment_type_created",
      entityType: "equipment_type",
      entityId: equipmentType.code,
      afterData: { code: equipmentType.code, label: equipmentType.label },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return equipmentType;
  }

  async updateStatus(code: string, status: ReferenceStatus, actor: ActorContext) {
    const before = await this.findByCodeOrThrow(code);
    const after = await this.prisma.equipmentType.update({ where: { code }, data: { status } });

    // RESTRICT on assets.equipment_type_code means a type in active use
    // can't be deleted — deactivating it here is the only supported way to
    // retire one, and existing assets referencing it are unaffected.
    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "equipment_type_status_changed",
      entityType: "equipment_type",
      entityId: code,
      beforeData: { status: before.status },
      afterData: { status: after.status },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  private async findByCodeOrThrow(code: string) {
    const equipmentType = await this.prisma.equipmentType.findUnique({ where: { code } });
    if (!equipmentType) throw new NotFoundException("Equipment type not found");
    return equipmentType;
  }
}
