import { Injectable } from "@nestjs/common";
import { PermissionRef } from "@agileworks/shared-types";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A user's effective permissions are the UNION of every permission granted
   * to every role in their user_roles rows — not just one role. Resolved
   * fresh from the database on every call (see PermissionsGuard) rather than
   * cached in the JWT, so revoking a role takes effect immediately.
   */
  async getEffectivePermissions(userId: string): Promise<PermissionRef[]> {
    const grants = await this.prisma.rolePermission.findMany({
      where: { role: { userRoles: { some: { userId } } } },
      select: { permission: { select: { module: true, action: true } } },
    });

    const seen = new Set<string>();
    const result: PermissionRef[] = [];
    for (const g of grants) {
      const key = `${g.permission.module}.${g.permission.action}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ module: g.permission.module, action: g.permission.action });
      }
    }
    return result;
  }

  async getRoleNames(userId: string): Promise<string[]> {
    const rows = await this.prisma.userRole.findMany({
      where: { userId },
      select: { role: { select: { name: true } } },
    });
    return rows.map((r) => r.role.name);
  }
}
