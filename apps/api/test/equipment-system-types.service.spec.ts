import { ReferenceStatus } from "@prisma/client";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { EquipmentSystemTypesService } from "../src/modules/equipment-reference/equipment-system-types.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { AuditService } from "../src/modules/audit/audit.service";
import { mockOf } from "./test-utils";

const actor = { userId: "actor-1", ipAddress: "127.0.0.1", userAgent: "jest" };

describe("EquipmentSystemTypesService — reference data, disable never delete", () => {
  it("has no delete method — deactivation is the only path", () => {
    const methodNames = Object.getOwnPropertyNames(EquipmentSystemTypesService.prototype);
    expect(methodNames).not.toContain("delete");
    expect(methodNames).not.toContain("remove");
  });

  it("rejects creating a system type whose code already exists", async () => {
    const prisma = mockOf<PrismaService>({
      equipmentSystemType: { findUnique: jest.fn().mockResolvedValue({ code: "VRV_VRF" }) },
    });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const service = new EquipmentSystemTypesService(prisma, audit);

    await expect(service.create({ code: "VRV_VRF", label: "VRV/VRF System" }, actor)).rejects.toThrow(
      ConflictException,
    );
    expect(audit.write).not.toHaveBeenCalled();
  });

  it("creates a new system type, defaulting sortOrder to 0, and audits equipment_system_type_created", async () => {
    const created = { code: "VRV_VRF", label: "VRV/VRF System", sortOrder: 0, status: ReferenceStatus.ACTIVE };
    const prisma = mockOf<PrismaService>({
      equipmentSystemType: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(created),
      },
    });
    const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
    const service = new EquipmentSystemTypesService(prisma, audit);

    const result = await service.create({ code: "VRV_VRF", label: "VRV/VRF System" }, actor);

    expect(result).toBe(created);
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "equipment_system_type_created",
        entityType: "equipment_system_type",
        entityId: "VRV_VRF",
      }),
    );
  });

  it("moves ACTIVE -> INACTIVE and audits before/after status", async () => {
    const before = { code: "VRV_VRF", status: ReferenceStatus.ACTIVE };
    const after = { ...before, status: ReferenceStatus.INACTIVE };
    const prisma = mockOf<PrismaService>({
      equipmentSystemType: {
        findUnique: jest.fn().mockResolvedValue(before),
        update: jest.fn().mockResolvedValue(after),
      },
    });
    const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
    const service = new EquipmentSystemTypesService(prisma, audit);

    const result = await service.updateStatus("VRV_VRF", ReferenceStatus.INACTIVE, actor);

    expect(result.status).toBe(ReferenceStatus.INACTIVE);
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "equipment_system_type_status_changed",
        beforeData: { status: ReferenceStatus.ACTIVE },
        afterData: { status: ReferenceStatus.INACTIVE },
      }),
    );
  });

  it("updateStatus throws NotFoundException for an unknown code", async () => {
    const prisma = mockOf<PrismaService>({ equipmentSystemType: { findUnique: jest.fn().mockResolvedValue(null) } });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const service = new EquipmentSystemTypesService(prisma, audit);

    await expect(service.updateStatus("GHOST", ReferenceStatus.INACTIVE, actor)).rejects.toThrow(NotFoundException);
  });
});
