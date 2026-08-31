import { Injectable, NotFoundException } from "@nestjs/common";
import { ActorType, EquipmentSystemStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ActorContext } from "../identity/users.service";
import { changedKeysOf, pickDefined } from "../../common/diff-fields.util";
import { CreateEquipmentSystemDto } from "./dto/create-equipment-system.dto";
import { UpdateEquipmentSystemDto } from "./dto/update-equipment-system.dto";

@Injectable()
export class EquipmentSystemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findByIdOrThrow(id: string) {
    const system = await this.prisma.equipmentSystem.findUnique({ where: { id } });
    if (!system) throw new NotFoundException("Equipment system not found");
    return system;
  }

  async listForSite(siteId: string) {
    await this.assertSiteExists(siteId);
    return this.prisma.equipmentSystem.findMany({ where: { siteId }, orderBy: { name: "asc" } });
  }

  async create(siteId: string, dto: CreateEquipmentSystemDto, actor: ActorContext) {
    await this.assertSiteExists(siteId);
    await this.assertSystemTypeExists(dto.systemTypeCode);

    const system = await this.prisma.equipmentSystem.create({ data: { ...dto, siteId } });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "equipment_system_created",
      entityType: "equipment_system",
      entityId: system.id,
      afterData: { siteId, name: system.name, systemTypeCode: system.systemTypeCode, status: system.status },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return system;
  }

  async update(id: string, dto: UpdateEquipmentSystemDto, actor: ActorContext) {
    const before = await this.findByIdOrThrow(id);
    if (dto.systemTypeCode) {
      await this.assertSystemTypeExists(dto.systemTypeCode);
    }

    const changedKeys = changedKeysOf(dto);
    const after = await this.prisma.equipmentSystem.update({ where: { id }, data: dto });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "equipment_system_updated",
      entityType: "equipment_system",
      entityId: id,
      beforeData: pickDefined(before, changedKeys),
      afterData: pickDefined(after, changedKeys),
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  async updateStatus(id: string, status: EquipmentSystemStatus, actor: ActorContext) {
    const before = await this.findByIdOrThrow(id);
    const after = await this.prisma.equipmentSystem.update({ where: { id }, data: { status } });

    // Deactivating a system never cascades to the assets grouped under it —
    // same independent-status principle as everywhere else in Phase 2.
    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "equipment_system_status_changed",
      entityType: "equipment_system",
      entityId: id,
      beforeData: { status: before.status },
      afterData: { status: after.status },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  private async assertSiteExists(siteId: string) {
    const exists = await this.prisma.site.findUnique({ where: { id: siteId }, select: { id: true } });
    if (!exists) throw new NotFoundException("Site not found");
  }

  private async assertSystemTypeExists(code: string) {
    const exists = await this.prisma.equipmentSystemType.findUnique({ where: { code }, select: { code: true } });
    if (!exists) throw new NotFoundException("Equipment system type not found");
  }
}
