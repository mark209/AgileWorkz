import { PermissionsService } from "../src/modules/identity/permissions.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { mockOf } from "./test-utils";

describe("PermissionsService — multi-role union (Phase 1 revision item 1)", () => {
  function makePrismaMock(rolePermissionRows: Array<{ permission: { module: string; action: string } }>) {
    return mockOf<PrismaService>({
      rolePermission: {
        findMany: jest.fn().mockResolvedValue(rolePermissionRows),
      },
      userRole: {
        findMany: jest.fn(),
      },
    });
  }

  it("returns the union of permissions across every role a user holds, deduplicated", async () => {
    // Simulates a user with two roles (e.g. Manager + Technician) whose
    // grants overlap on one permission and differ on another.
    const prisma = makePrismaMock([
      { permission: { module: "audit_logs", action: "read" } }, // from role A
      { permission: { module: "system_settings", action: "manage" } }, // from role B
      { permission: { module: "audit_logs", action: "read" } }, // duplicate — same permission via a different role
    ]);
    const service = new PermissionsService(prisma);

    const result = await service.getEffectivePermissions("user-1");

    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        { module: "audit_logs", action: "read" },
        { module: "system_settings", action: "manage" },
      ]),
    );
  });

  it("returns an empty list for a user with no role grants", async () => {
    const prisma = makePrismaMock([]);
    const service = new PermissionsService(prisma);

    const result = await service.getEffectivePermissions("user-2");

    expect(result).toEqual([]);
  });

  it("queries by role membership through user_roles, not a single role_id", async () => {
    const prisma = makePrismaMock([]);
    const service = new PermissionsService(prisma);

    await service.getEffectivePermissions("user-3");

    expect(prisma.rolePermission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: { userRoles: { some: { userId: "user-3" } } } },
      }),
    );
  });
});
