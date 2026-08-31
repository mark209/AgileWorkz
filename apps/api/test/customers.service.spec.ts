import { CustomerStatus, CustomerType } from "@prisma/client";
import { NotFoundException } from "@nestjs/common";
import { CustomersService } from "../src/modules/customers/customers.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { AuditService } from "../src/modules/audit/audit.service";
import { mockOf } from "./test-utils";

const actor = { userId: "actor-1", ipAddress: "127.0.0.1", userAgent: "jest" };

describe("CustomersService — status is the only lifecycle mechanism (no delete)", () => {
  it("has no delete method — deactivation is the only path", () => {
    const methodNames = Object.getOwnPropertyNames(CustomersService.prototype);
    expect(methodNames).not.toContain("delete");
    expect(methodNames).not.toContain("remove");
  });

  it("creates a customer and audits customer_created", async () => {
    const created = {
      id: "c1",
      name: "ABC Corporation",
      customerType: CustomerType.COMMERCIAL,
      status: CustomerStatus.ACTIVE,
    };
    const prisma = mockOf<PrismaService>({
      customer: { create: jest.fn().mockResolvedValue(created) },
    });
    const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
    const service = new CustomersService(prisma, audit);

    const result = await service.create(
      { name: "ABC Corporation", customerType: CustomerType.COMMERCIAL, billingAddress: "123 Main St" },
      actor,
    );

    expect(result).toBe(created);
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: "customer_created", entityType: "customer", entityId: "c1" }),
    );
  });

  it("rejects creating a customer with an accountManagerId that doesn't resolve to a real user", async () => {
    const prisma = mockOf<PrismaService>({
      user: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const service = new CustomersService(prisma, audit);

    await expect(
      service.create(
        {
          name: "ABC Corporation",
          customerType: CustomerType.COMMERCIAL,
          billingAddress: "123 Main St",
          accountManagerId: "does-not-exist",
        },
        actor,
      ),
    ).rejects.toThrow(NotFoundException);
    expect(audit.write).not.toHaveBeenCalled();
  });

  it("update() audits only the fields the DTO actually changed, not the whole row", async () => {
    const before = { id: "c1", name: "Old Name", billingAddress: "Old Address", status: CustomerStatus.ACTIVE };
    const after = { ...before, name: "New Name" };
    const prisma = mockOf<PrismaService>({
      customer: {
        findUnique: jest.fn().mockResolvedValue(before),
        update: jest.fn().mockResolvedValue(after),
      },
    });
    const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
    const service = new CustomersService(prisma, audit);

    await service.update("c1", { name: "New Name" }, actor);

    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "customer_updated",
        beforeData: { name: "Old Name" },
        afterData: { name: "New Name" },
      }),
    );
  });

  it("moves ACTIVE -> INACTIVE without touching any other field, and audits before/after status", async () => {
    const before = { id: "c1", name: "ABC Corporation", status: CustomerStatus.ACTIVE };
    const after = { ...before, status: CustomerStatus.INACTIVE };
    const prisma = mockOf<PrismaService>({
      customer: {
        findUnique: jest.fn().mockResolvedValue(before),
        update: jest.fn().mockResolvedValue(after),
      },
    });
    const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
    const service = new CustomersService(prisma, audit);

    const result = await service.updateStatus("c1", CustomerStatus.INACTIVE, actor);

    expect(result.status).toBe(CustomerStatus.INACTIVE);
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c1" }, data: { status: CustomerStatus.INACTIVE } }),
    );
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "customer_status_changed",
        beforeData: { status: CustomerStatus.ACTIVE },
        afterData: { status: CustomerStatus.INACTIVE },
      }),
    );
  });

  it("findByIdOrThrow throws NotFoundException for a missing customer", async () => {
    const prisma = mockOf<PrismaService>({ customer: { findUnique: jest.fn().mockResolvedValue(null) } });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const service = new CustomersService(prisma, audit);

    await expect(service.findByIdOrThrow("missing")).rejects.toThrow(NotFoundException);
  });
});
