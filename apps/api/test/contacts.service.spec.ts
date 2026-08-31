import { ContactStatus } from "@prisma/client";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ContactsService } from "../src/modules/customers/contacts.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { AuditService } from "../src/modules/audit/audit.service";
import { mockOf } from "./test-utils";

const actor = { userId: "actor-1", ipAddress: "127.0.0.1", userAgent: "jest" };

describe("ContactsService — status is the only lifecycle mechanism (no delete)", () => {
  it("has no delete method — deactivation is the only path", () => {
    const methodNames = Object.getOwnPropertyNames(ContactsService.prototype);
    expect(methodNames).not.toContain("delete");
    expect(methodNames).not.toContain("remove");
  });

  it("rejects creating a contact with neither phone nor email", async () => {
    const prisma = mockOf<PrismaService>({
      customer: { findUnique: jest.fn().mockResolvedValue({ id: "cust-1" }) },
    });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const service = new ContactsService(prisma, audit);

    await expect(service.create("cust-1", { fullName: "Jane Cruz" }, actor)).rejects.toThrow(BadRequestException);
    expect(audit.write).not.toHaveBeenCalled();
  });

  it("rejects creating a contact under a customer that doesn't exist", async () => {
    const prisma = mockOf<PrismaService>({
      customer: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const service = new ContactsService(prisma, audit);

    await expect(
      service.create("missing-customer", { fullName: "Jane Cruz", email: "jane@example.com" }, actor),
    ).rejects.toThrow(NotFoundException);
  });

  it("creates a contact with only a phone (no email) and audits contact_created", async () => {
    const created = { id: "ct1", customerId: "cust-1", fullName: "Jane Cruz", status: ContactStatus.ACTIVE };
    const prisma = mockOf<PrismaService>({
      customer: { findUnique: jest.fn().mockResolvedValue({ id: "cust-1" }) },
      contact: { create: jest.fn().mockResolvedValue(created) },
    });
    const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
    const service = new ContactsService(prisma, audit);

    const result = await service.create("cust-1", { fullName: "Jane Cruz", phone: "+63 900 000 0000" }, actor);

    expect(result).toBe(created);
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: "contact_created", entityType: "contact", entityId: "ct1" }),
    );
  });

  it("rejects an update that would clear the only remaining contact method", async () => {
    const before = { id: "ct1", phone: "+63 900 000 0000", email: null, status: ContactStatus.ACTIVE };
    const prisma = mockOf<PrismaService>({
      contact: { findUnique: jest.fn().mockResolvedValue(before) },
    });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const service = new ContactsService(prisma, audit);

    await expect(service.update("ct1", { phone: "" }, actor)).rejects.toThrow(BadRequestException);
  });

  it("allows an update that swaps phone for email, keeping exactly one contact method", async () => {
    const before = { id: "ct1", phone: "+63 900 000 0000", email: null, status: ContactStatus.ACTIVE };
    const after = { ...before, phone: null, email: "jane@example.com" };
    const prisma = mockOf<PrismaService>({
      contact: {
        findUnique: jest.fn().mockResolvedValue(before),
        update: jest.fn().mockResolvedValue(after),
      },
    });
    const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
    const service = new ContactsService(prisma, audit);

    const result = await service.update("ct1", { phone: "", email: "jane@example.com" }, actor);

    expect(result.email).toBe("jane@example.com");
  });

  it("moves ACTIVE -> INACTIVE and audits before/after status", async () => {
    const before = { id: "ct1", status: ContactStatus.ACTIVE };
    const after = { ...before, status: ContactStatus.INACTIVE };
    const prisma = mockOf<PrismaService>({
      contact: {
        findUnique: jest.fn().mockResolvedValue(before),
        update: jest.fn().mockResolvedValue(after),
      },
    });
    const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
    const service = new ContactsService(prisma, audit);

    const result = await service.updateStatus("ct1", ContactStatus.INACTIVE, actor);

    expect(result.status).toBe(ContactStatus.INACTIVE);
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "contact_status_changed",
        beforeData: { status: ContactStatus.ACTIVE },
        afterData: { status: ContactStatus.INACTIVE },
      }),
    );
  });
});
