import { ReferenceStatus } from "@prisma/client";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { CapacityUnitsService } from "../src/modules/equipment-reference/capacity-units.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { AuditService } from "../src/modules/audit/audit.service";
import { mockOf } from "./test-utils";

const actor = { userId: "actor-1", ipAddress: "127.0.0.1", userAgent: "jest" };

describe("CapacityUnitsService — reference data, disable never delete", () => {
  it("has no delete method — deactivation is the only path", () => {
    const methodNames = Object.getOwnPropertyNames(CapacityUnitsService.prototype);
    expect(methodNames).not.toContain("delete");
    expect(methodNames).not.toContain("remove");
  });

  it("rejects creating a unit whose code already exists", async () => {
    const prisma = mockOf<PrismaService>({
      capacityUnit: { findUnique: jest.fn().mockResolvedValue({ code: "TR" }) },
    });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const service = new CapacityUnitsService(prisma, audit);

    await expect(service.create({ code: "TR", label: "Tons of Refrigeration" }, actor)).rejects.toThrow(
      ConflictException,
    );
    expect(audit.write).not.toHaveBeenCalled();
  });

  it("creates a new unit, defaulting sortOrder to 0, and audits capacity_unit_created", async () => {
    const created = { code: "MBH", label: "1,000 BTU per Hour", sortOrder: 0, status: ReferenceStatus.ACTIVE };
    const prisma = mockOf<PrismaService>({
      capacityUnit: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(created),
      },
    });
    const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
    const service = new CapacityUnitsService(prisma, audit);

    const result = await service.create({ code: "MBH", label: "1,000 BTU per Hour" }, actor);

    expect(result).toBe(created);
    expect(prisma.capacityUnit.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { code: "MBH", label: "1,000 BTU per Hour", sortOrder: 0 } }),
    );
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: "capacity_unit_created", entityType: "capacity_unit", entityId: "MBH" }),
    );
  });

  it("moves ACTIVE -> INACTIVE and audits before/after status", async () => {
    const before = { code: "TR", status: ReferenceStatus.ACTIVE };
    const after = { ...before, status: ReferenceStatus.INACTIVE };
    const prisma = mockOf<PrismaService>({
      capacityUnit: {
        findUnique: jest.fn().mockResolvedValue(before),
        update: jest.fn().mockResolvedValue(after),
      },
    });
    const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
    const service = new CapacityUnitsService(prisma, audit);

    const result = await service.updateStatus("TR", ReferenceStatus.INACTIVE, actor);

    expect(result.status).toBe(ReferenceStatus.INACTIVE);
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "capacity_unit_status_changed",
        beforeData: { status: ReferenceStatus.ACTIVE },
        afterData: { status: ReferenceStatus.INACTIVE },
      }),
    );
  });

  it("updateStatus throws NotFoundException for an unknown code", async () => {
    const prisma = mockOf<PrismaService>({ capacityUnit: { findUnique: jest.fn().mockResolvedValue(null) } });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const service = new CapacityUnitsService(prisma, audit);

    await expect(service.updateStatus("GHOST", ReferenceStatus.INACTIVE, actor)).rejects.toThrow(NotFoundException);
  });
});
