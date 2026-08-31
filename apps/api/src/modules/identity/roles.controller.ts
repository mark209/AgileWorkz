import { Controller, Delete, Get, Param, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { RolesService } from "./roles.service";
import { Permissions } from "../../common/guards/permissions.decorator";

interface AuthedRequest extends Request {
  user: { userId: string };
}

// No @UseGuards(PermissionsGuard) — it's already global (AppModule's
// APP_GUARD); see the comment in audit.controller.ts for why repeating it
// per-controller is both redundant and, in modules that don't import
// IdentityModule, a DI resolution error.
@Permissions({ module: "roles", action: "manage" })
@Controller("roles")
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  async list() {
    return this.rolesService.list();
  }

  @Get("permissions")
  async listPermissions() {
    return this.rolesService.listPermissions();
  }

  @Post(":roleId/permissions/:permissionId")
  async grant(
    @Param("roleId") roleId: string,
    @Param("permissionId") permissionId: string,
    @Req() req: AuthedRequest,
  ) {
    await this.rolesService.grantPermission(roleId, permissionId, {
      userId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.get("user-agent") ?? undefined,
    });
    return { granted: true };
  }

  @Delete(":roleId/permissions/:permissionId")
  async revoke(
    @Param("roleId") roleId: string,
    @Param("permissionId") permissionId: string,
    @Req() req: AuthedRequest,
  ) {
    await this.rolesService.revokePermission(roleId, permissionId, {
      userId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.get("user-agent") ?? undefined,
    });
    return { revoked: true };
  }
}
