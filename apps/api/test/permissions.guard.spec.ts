import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PermissionsGuard } from "../src/common/guards/permissions.guard";
import { PermissionsService } from "../src/modules/identity/permissions.service";
import { mockOf } from "./test-utils";

function makeContext(user: { userId: string } | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe("PermissionsGuard", () => {
  it("allows a route with no @Permissions() metadata", async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) } as unknown as Reflector;
    const getEffectivePermissions = jest.fn();
    const permissionsService = mockOf<PermissionsService>({ getEffectivePermissions });
    const guard = new PermissionsGuard(reflector, permissionsService);

    await expect(guard.canActivate(makeContext({ userId: "u1" }))).resolves.toBe(true);
    expect(getEffectivePermissions).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request when permissions are required", async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([{ module: "users", action: "manage" }]),
    } as unknown as Reflector;
    const permissionsService = mockOf<PermissionsService>({ getEffectivePermissions: jest.fn() });
    const guard = new PermissionsGuard(reflector, permissionsService);

    await expect(guard.canActivate(makeContext(undefined))).rejects.toThrow(ForbiddenException);
  });

  it("allows a user whose effective permissions include the required one", async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([{ module: "system_settings", action: "manage" }]),
    } as unknown as Reflector;
    const permissionsService = mockOf<PermissionsService>({
      getEffectivePermissions: jest.fn().mockResolvedValue([{ module: "system_settings", action: "manage" }]),
    });
    const guard = new PermissionsGuard(reflector, permissionsService);

    await expect(guard.canActivate(makeContext({ userId: "u1" }))).resolves.toBe(true);
  });

  it("rejects a user missing the required permission — a role granting it doesn't leak to routes for other permissions", async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([{ module: "users", action: "manage" }]),
    } as unknown as Reflector;
    const permissionsService = mockOf<PermissionsService>({
      getEffectivePermissions: jest.fn().mockResolvedValue([{ module: "audit_logs", action: "read" }]),
    });
    const guard = new PermissionsGuard(reflector, permissionsService);

    await expect(guard.canActivate(makeContext({ userId: "u1" }))).rejects.toThrow(ForbiddenException);
  });
});
