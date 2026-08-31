import * as argon2 from "argon2";
import { UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { User, UserStatus } from "@prisma/client";
import { AuthService } from "../src/modules/identity/auth.service";
import { UsersService } from "../src/modules/identity/users.service";
import { PermissionsService } from "../src/modules/identity/permissions.service";
import { AuditService } from "../src/modules/audit/audit.service";
import { mockOf } from "./test-utils";

describe("AuthService.login", () => {
  const meta = { ipAddress: "127.0.0.1", userAgent: "jest" };

  async function makeService(user: Pick<User, "id" | "fullName" | "email" | "passwordHash" | "status"> | null) {
    const users = mockOf<UsersService>({
      findByEmailWithSecrets: jest.fn().mockResolvedValue(user),
      recordLogin: jest.fn().mockResolvedValue(undefined),
    });
    const permissions = mockOf<PermissionsService>({
      getRoleNames: jest.fn().mockResolvedValue(["Technician"]),
      getEffectivePermissions: jest.fn().mockResolvedValue([]),
    });
    const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
    const jwt = mockOf<JwtService>({ sign: jest.fn().mockReturnValue("signed-token"), verify: jest.fn() });
    const service = new AuthService(users, permissions, audit, jwt);
    return { service, users, permissions, audit, jwt };
  }

  it("rejects an unknown email and records a SYSTEM-actor audit event (no user to attribute it to)", async () => {
    const { service, audit } = await makeService(null);

    await expect(service.login("nobody@example.com", "whatever", meta)).rejects.toThrow(UnauthorizedException);

    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: "SYSTEM", action: "login_failed" }),
    );
  });

  it("rejects a correct password for an INACTIVE account, and never issues tokens", async () => {
    const passwordHash = await argon2.hash("correct-horse-battery-staple");
    const { service, audit, jwt } = await makeService({
      id: "user-1",
      fullName: "Jane Tech",
      email: "jane@example.com",
      passwordHash,
      status: UserStatus.INACTIVE,
    });

    await expect(service.login("jane@example.com", "correct-horse-battery-staple", meta)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(jwt.sign).not.toHaveBeenCalled();
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: "USER", actorUserId: "user-1", action: "login_failed" }),
    );
  });

  it("rejects a wrong password for an ACTIVE account", async () => {
    const passwordHash = await argon2.hash("the-real-password");
    const { service, audit } = await makeService({
      id: "user-2",
      fullName: "Jane Tech",
      email: "jane@example.com",
      passwordHash,
      status: UserStatus.ACTIVE,
    });

    await expect(service.login("jane@example.com", "wrong-password", meta)).rejects.toThrow(UnauthorizedException);
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: "USER", actorUserId: "user-2", action: "login_failed" }),
    );
  });

  it("issues tokens and logs a login event for a correct password on an ACTIVE account", async () => {
    const passwordHash = await argon2.hash("the-real-password");
    const { service, audit, users } = await makeService({
      id: "user-3",
      fullName: "Jane Tech",
      email: "jane@example.com",
      passwordHash,
      status: UserStatus.ACTIVE,
    });

    const result = await service.login("jane@example.com", "the-real-password", meta);

    expect(result.accessToken).toBe("signed-token");
    expect(result.user.id).toBe("user-3");
    expect(users.recordLogin).toHaveBeenCalledWith("user-3");
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: "USER", actorUserId: "user-3", action: "login" }),
    );
  });
});
