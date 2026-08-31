import { EquipmentSystemStatus } from "@prisma/client";
import { NotFoundException } from "@nestjs/common";
import { EquipmentSystemsService } from "../src/modules/equipment/equipment-systems.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { AuditService } from "../src/modules/audit/audit.service";
import { mockOf } from "./test-utils";

const actor = { userId: "actor-1", ipAddress: "127.0.0.1", userAgent: "jest" };

describe("EquipmentSystemsService — status is the only lifecycle mechanism (no delete)", () => {
  it("has no delete method — deactivation is the only path", () => {
    const methodNames = Object.getOwnPropertyNames(EquipmentSystemsService.prototype);
    expect(methodNames).not.toContain("delete");
    expect(methodNames).not.toContain("remove");
  });

  it("rejects creating a system under a site that doesn't exist", async () => {
    const prisma = mockOf<PrismaService>({ site: { findUnique: jest.fn().mockResolvedValue(null) } });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const service = new EquipmentSystemsService(prisma, audit);

    await expect(
      service.create("missing-site", { name: "VRF System", systemTypeCode: "VRV_VRF" }, actor),
    ).rejects.toThrow(NotFoundException);
  });

  it("rejects creating a system with a systemTypeCode that doesn't exist", async () => {
    const prisma = mockOf<PrismaService>({
      site: { findUnique: jest.fn().mockResolvedValue({ id: "site-1" }) },
      equipmentSystemType: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const service = new EquipmentSystemsService(prisma, audit);

    await expect(
      service.create("site-1", { name: "VRF System", systemTypeCode: "GHOST" }, actor),
    ).rejects.toThrow(NotFoundException);
  });

  it("creates a system and audits equipment_system_created", async () => {
    const created = {
      id: "es1",
      siteId: "site-1",
      name: "VRF System — Roof Zone A",
      systemTypeCode: "VRV_VRF",
      status: EquipmentSystemStatus.ACTIVE,
    };
    const prisma = mockOf<PrismaService>({
      site: { findUnique: jest.fn().mockResolvedValue({ id: "site-1" }) },
      equipmentSystemType: { findUnique: jest.fn().mockResolvedValue({ code: "VRV_VRF" }) },
      equipmentSystem: { create: jest.fn().mockResolvedValue(created) },
    });
    const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
    const service = new EquipmentSystemsService(prisma, audit);

    const result = await service.create(
      "site-1",
      { name: "VRF System — Roof Zone A", systemTypeCode: "VRV_VRF" },
      actor,
    );

    expect(result).toBe(created);
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: "equipment_system_created", entityType: "equipment_system", entityId: "es1" }),
    );
  });

  it("update() audits only the fields the DTO actually changed", async () => {
    const before = { id: "es1", siteId: "site-1", name: "Old Name", status: EquipmentSystemStatus.ACTIVE };
    const after = { ...before, name: "New Name" };
    const prisma = mockOf<PrismaService>({
      equipmentSystem: {
        findUnique: jest.fn().mockResolvedValue(before),
        update: jest.fn().mockResolvedValue(after),
      },
    });
    const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
    const service = new EquipmentSystemsService(prisma, audit);

    await service.update("es1", { name: "New Name" }, actor);

    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "equipment_system_updated",
        beforeData: { name: "Old Name" },
        afterData: { name: "New Name" },
      }),
    );
  });

  it("moves ACTIVE -> INACTIVE and audits before/after status", async () => {
    const before = { id: "es1", status: EquipmentSystemStatus.ACTIVE };
    const after = { ...before, status: EquipmentSystemStatus.INACTIVE };
    const prisma = mockOf<PrismaService>({
      equipmentSystem: {
        findUnique: jest.fn().mockResolvedValue(before),
        update: jest.fn().mockResolvedValue(after),
      },
    });
    const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
    const service = new EquipmentSystemsService(prisma, audit);

    const result = await service.updateStatus("es1", EquipmentSystemStatus.INACTIVE, actor);

    expect(result.status).toBe(EquipmentSystemStatus.INACTIVE);
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "equipment_system_status_changed",
        beforeData: { status: EquipmentSystemStatus.ACTIVE },
        afterData: { status: EquipmentSystemStatus.INACTIVE },
      }),
    );
  });

  it("findByIdOrThrow throws NotFoundException for a missing system", async () => {
    const prisma = mockOf<PrismaService>({ equipmentSystem: { findUnique: jest.fn().mockResolvedValue(null) } });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const service = new EquipmentSystemsService(prisma, audit);

    await expect(service.findByIdOrThrow("missing")).rejects.toThrow(NotFoundException);
  });
});
