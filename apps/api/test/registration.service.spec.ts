import { BadRequestException, ForbiddenException } from "@nestjs/common";
import * as argon2 from "argon2";
import { UsersService } from "../src/modules/identity/users.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { AuditService } from "../src/modules/audit/audit.service";

jest.mock("argon2", () => ({ hash: jest.fn().mockResolvedValue("hashed-password") }));

const applicant = {
  fullName: "Alex Santos", email: "Alex@Example.com", password: "a-long-password",
  requestedRoleId: "role-manager",
};
const actor = { userId: "admin-1", ipAddress: "127.0.0.1" };

function serviceWith(prisma: object) {
  const audit = { write: jest.fn().mockResolvedValue(undefined) };
  return { service: new UsersService(prisma as PrismaService, audit as unknown as AuditService), audit };
}

describe("registration approval", () => {
  beforeEach(() => jest.clearAllMocks());

  it("stores a pending request with a hashed password and grants no user role", async () => {
    const tx = { registrationRequest: { create: jest.fn().mockResolvedValue({ id: "request-1" }) } };
    const prisma = {
      role: { findUnique: jest.fn().mockResolvedValue({ id: "role-manager", name: "Manager" }) },
      user: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      registrationRequest: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((action) => action(tx)),
    };
    const { service, audit } = serviceWith(prisma);

    await service.requestRegistration(applicant, { ipAddress: "127.0.0.1" });

    expect(tx.registrationRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: "alex@example.com", passwordHash: "hashed-password", requestedRoleId: "role-manager" }),
    }));
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: "registration_requested" }), tx);
  });

  it("rejects an Admin/Owner designation submitted through the public API", async () => {
    const prisma = { role: { findUnique: jest.fn().mockResolvedValue({ id: "role-admin", name: "Admin/Owner" }) } };
    const { service } = serviceWith(prisma);
    await expect(service.requestRegistration({ ...applicant, requestedRoleId: "role-admin" }, {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it("returns without creating a second request for an existing email", async () => {
    const prisma = {
      role: { findUnique: jest.fn().mockResolvedValue({ id: "role-manager", name: "Manager" }) },
      user: { findFirst: jest.fn().mockResolvedValue({ id: "existing" }) },
      registrationRequest: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(),
    };
    const { service } = serviceWith(prisma);
    await expect(service.requestRegistration(applicant, {})).resolves.toBeUndefined();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(argon2.hash).not.toHaveBeenCalled();
  });

  it("lets Admin/Owner choose the final role and creates the account atomically", async () => {
    const request = { id: "request-1", fullName: "Alex Santos", email: "alex@example.com", phone: null, passwordHash: "hashed-password", requestedRoleId: "role-manager" };
    const tx = {
      userRole: { findFirst: jest.fn().mockResolvedValue({ userId: actor.userId }), create: jest.fn().mockResolvedValue({}) },
      registrationRequest: { findUnique: jest.fn().mockResolvedValue(request), delete: jest.fn().mockResolvedValue(request) },
      role: { findUnique: jest.fn().mockResolvedValue({ id: "role-tech", name: "Technician" }) },
      user: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: "user-1", fullName: request.fullName, email: request.email, status: "ACTIVE" }) },
    };
    const transaction = jest.fn((action) => action(tx));
    const { service, audit } = serviceWith({ $transaction: transaction });

    const user = await service.approveRegistration(request.id, "role-tech", actor);

    expect(user.id).toBe("user-1");
    expect(tx.userRole.create).toHaveBeenCalledWith({ data: { userId: "user-1", roleId: "role-tech", assignedBy: actor.userId } });
    expect(tx.registrationRequest.delete).toHaveBeenCalledWith({ where: { id: request.id } });
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: "registration_approved" }), tx);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 30_000 });
  });

  it("removes a declined request without creating a user", async () => {
    const tx = {
      userRole: { findFirst: jest.fn().mockResolvedValue({ userId: actor.userId }) },
      registrationRequest: { findUnique: jest.fn().mockResolvedValue({ id: "request-1" }), delete: jest.fn().mockResolvedValue({}) },
      user: { create: jest.fn() },
    };
    const { service, audit } = serviceWith({ $transaction: jest.fn((action) => action(tx)) });
    await service.declineRegistration("request-1", actor);
    expect(tx.registrationRequest.delete).toHaveBeenCalled();
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: "registration_declined" }), tx);
  });

  it("denies review when the caller lacks the Admin/Owner role", async () => {
    const prisma = {
      userRole: { findFirst: jest.fn().mockResolvedValue(null) },
      registrationRequest: { findMany: jest.fn() },
    };
    const { service } = serviceWith(prisma);
    await expect(service.listRegistrationRequests({ userId: "manager-1" })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.registrationRequest.findMany).not.toHaveBeenCalled();
  });
});
