import { SetMetadata } from "@nestjs/common";
import { PermissionRef } from "@agileworks/shared-types";

export const PERMISSIONS_KEY = "requiredPermissions";

/**
 * Declares which (module, action) permission a route requires. Checked by
 * PermissionsGuard against the caller's *effective* permissions — the union
 * across every role in their user_roles rows, resolved fresh per request.
 */
export const Permissions = (...permissions: PermissionRef[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
