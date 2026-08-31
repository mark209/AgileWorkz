import { Injectable, NotFoundException } from "@nestjs/common";
import { ActorType } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ActorContext } from "./users.service";

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    return this.prisma.role.findMany({
      include: { rolePermissions: { include: { permission: true } } },
      orderBy: { name: "asc" },
    });
  }

  async listPermissions() {
    return this.prisma.permission.findMany({ orderBy: [{ module: "asc" }, { action: "asc" }] });
  }

  async grantPermission(roleId: string, permissionId: string, actor: ActorContext) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException("Role not found");

    await this.prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId, permissionId } },
      update: {},
      create: { roleId, permissionId },
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "permission_granted",
      entityType: "role_permission",
      entityId: `${roleId}:${permissionId}`,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }

  async revokePermission(roleId: string, permissionId: string, actor: ActorContext) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException("Role not found");

    // is_system protects the role row itself from deletion (§03 of the
    // blueprint); it does not freeze that role's permission grants — an
    // Admin/Owner can still reconfigure what a seeded role can do.
    await this.prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId, permissionId } } });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "permission_revoked",
      entityType: "role_permission",
      entityId: `${roleId}:${permissionId}`,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }
}
