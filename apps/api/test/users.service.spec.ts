import { UserStatus } from "@prisma/client";
import { UsersService } from "../src/modules/identity/users.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { AuditService } from "../src/modules/audit/audit.service";
import { mockOf } from "./test-utils";

const actor = { userId: "actor-1", ipAddress: "127.0.0.1", userAgent: "jest" };

function makePrismaMock(existingUser: { id: string; status: UserStatus }) {
  return mockOf<PrismaService>({
    user: {
      findUnique: jest.fn().mockResolvedValue(existingUser),
      update: jest.fn().mockImplementation(({ data }: { data: Partial<{ status: UserStatus }> }) => ({
        ...existingUser,
        ...data,
      })),
    },
  });
}

describe("UsersService — status is the only lifecycle mechanism (no delete)", () => {
  it("has no delete method — deactivation is the only path", () => {
    const methodNames = Object.getOwnPropertyNames(UsersService.prototype);
    expect(methodNames).not.toContain("delete");
    expect(methodNames).not.toContain("remove");
  });

  it("moves ACTIVE -> INACTIVE and audits the before/after status, keeping the row", async () => {
    const existing = { id: "u1", status: UserStatus.ACTIVE };
    const prisma = makePrismaMock(existing);
    const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
    const service = new UsersService(prisma, audit);

    const result = await service.updateStatus("u1", UserStatus.INACTIVE, actor);

    expect(result.status).toBe(UserStatus.INACTIVE);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "u1" }, data: { status: UserStatus.INACTIVE } }),
    );
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user_status_changed",
        beforeData: { status: UserStatus.ACTIVE },
        afterData: { status: UserStatus.INACTIVE },
      }),
    );
  });

  it("supports SUSPENDED as distinct from INACTIVE", async () => {
    const existing = { id: "u2", status: UserStatus.ACTIVE };
    const prisma = makePrismaMock(existing);
    const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
    const service = new UsersService(prisma, audit);

    const result = await service.updateStatus("u2", UserStatus.SUSPENDED, actor);

    expect(result.status).toBe(UserStatus.SUSPENDED);
  });
});
