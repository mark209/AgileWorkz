import { Injectable, NotFoundException } from "@nestjs/common";
import { ActorType } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ActorContext } from "../identity/users.service";

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    return this.prisma.systemSetting.findMany({ orderBy: { key: "asc" } });
  }

  async get(key: string) {
    const setting = await this.prisma.systemSetting.findUnique({ where: { key } });
    if (!setting) throw new NotFoundException(`Unknown setting: ${key}`);
    return setting;
  }

  async update(key: string, value: string, actor: ActorContext) {
    const before = await this.get(key);

    const after = await this.prisma.systemSetting.update({
      where: { key },
      data: { value, updatedBy: actor.userId },
    });

    // Every configuration change is audited with the actual before/after
    // value — this is the record that makes a threshold change reviewable.
    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "system_setting_changed",
      entityType: "system_settings",
      entityId: key,
      beforeData: { value: before.value },
      afterData: { value: after.value },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }
}
