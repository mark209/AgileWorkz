import { ReferenceStatus } from "@prisma/client";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { EquipmentTypesService } from "../src/modules/equipment-reference/equipment-types.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { AuditService } from "../src/modules/audit/audit.service";
import { mockOf } from "./test-utils";

const actor = { userId: "actor-1", ipAddress: "127.0.0.1", userAgent: "jest" };

describe("EquipmentTypesService — reference data, disable never delete", () => {
  it("has no delete method — deactivation is the only path", () => {
    const methodNames = Object.getOwnPropertyNames(EquipmentTypesService.prototype);
    expect(methodNames).not.toContain("delete");
    expect(methodNames).not.toContain("remove");
  });

  it("rejects creating a type whose code already exists", async () => {
    const prisma = mockOf<PrismaService>({
      equipmentType: { findUnique: jest.fn().mockResolvedValue({ code: "FCU" }) },
    });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const service = new EquipmentTypesService(prisma, audit);

    await expect(service.create({ code: "FCU", label: "Fan Coil Unit" }, actor)).rejects.toThrow(ConflictException);
    expect(audit.write).not.toHaveBeenCalled();
  });

  it("creates a new type, defaulting sortOrder to 0, and audits equipment_type_created", async () => {
    const created = { code: "FCU", label: "Fan Coil Unit", sortOrder: 0, status: ReferenceStatus.ACTIVE };
    const prisma = mockOf<PrismaService>({
      equipmentType: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(created),
      },
    });
    const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
    const service = new EquipmentTypesService(prisma, audit);

    const result = await service.create({ code: "FCU", label: "Fan Coil Unit" }, actor);

    expect(result).toBe(created);
    expect(prisma.equipmentType.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { code: "FCU", label: "Fan Coil Unit", sortOrder: 0 } }),
    );
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: "equipment_type_created", entityType: "equipment_type", entityId: "FCU" }),
    );
  });

  it("moves ACTIVE -> INACTIVE and audits before/after status", async () => {
    const before = { code: "FCU", status: ReferenceStatus.ACTIVE };
    const after = { ...before, status: ReferenceStatus.INACTIVE };
    const prisma = mockOf<PrismaService>({
      equipmentType: {
        findUnique: jest.fn().mockResolvedValue(before),
        update: jest.fn().mockResolvedValue(after),
      },
    });
    const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
    const service = new EquipmentTypesService(prisma, audit);

    const result = await service.updateStatus("FCU", ReferenceStatus.INACTIVE, actor);

    expect(result.status).toBe(ReferenceStatus.INACTIVE);
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "equipment_type_status_changed",
        beforeData: { status: ReferenceStatus.ACTIVE },
        afterData: { status: ReferenceStatus.INACTIVE },
      }),
    );
  });

  it("updateStatus throws NotFoundException for an unknown code", async () => {
    const prisma = mockOf<PrismaService>({ equipmentType: { findUnique: jest.fn().mockResolvedValue(null) } });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const service = new EquipmentTypesService(prisma, audit);

    await expect(service.updateStatus("GHOST", ReferenceStatus.INACTIVE, actor)).rejects.toThrow(NotFoundException);
  });
});
