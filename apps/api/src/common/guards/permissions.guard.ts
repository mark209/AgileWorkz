import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PermissionRef } from "@agileworks/shared-types";
import { PERMISSIONS_KEY } from "./permissions.decorator";
import { PermissionsService } from "../../modules/identity/permissions.service";

interface RequestUser {
  userId: string;
}

/**
 * Resolves the caller's effective permissions fresh from user_roles ->
 * role_permissions on every request (not from JWT claims), so a permission
 * or role change takes effect immediately without waiting for token expiry.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionRef[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as RequestUser | undefined;
    if (!user) {
      throw new ForbiddenException("Not authenticated");
    }

    const granted = await this.permissionsService.getEffectivePermissions(user.userId);
    const grantedSet = new Set(granted.map((p) => `${p.module}.${p.action}`));

    const missing = required.filter((r) => !grantedSet.has(`${r.module}.${r.action}`));
    if (missing.length > 0) {
      throw new ForbiddenException(
        `Missing required permission(s): ${missing.map((m) => `${m.module}.${m.action}`).join(", ")}`,
      );
    }

    return true;
  }
}
