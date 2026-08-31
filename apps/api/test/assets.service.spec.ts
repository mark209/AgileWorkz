import { AssetStatus } from "@prisma/client";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { AssetsService } from "../src/modules/equipment/assets.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { AuditService } from "../src/modules/audit/audit.service";
import { mockOf } from "./test-utils";

const actor = { userId: "actor-1", ipAddress: "127.0.0.1", userAgent: "jest" };

const baseCreateDto = { assetTag: "AC-101-IDU", equipmentTypeCode: "SPLIT_INDOOR" };

describe("AssetsService — status is the only lifecycle mechanism (no delete)", () => {
  it("has no delete method — deactivation is the only path", () => {
    const methodNames = Object.getOwnPropertyNames(AssetsService.prototype);
    expect(methodNames).not.toContain("delete");
    expect(methodNames).not.toContain("remove");
  });

  it("rejects creating an asset under a site that doesn't exist", async () => {
    const prisma = mockOf<PrismaService>({ site: { findUnique: jest.fn().mockResolvedValue(null) } });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const service = new AssetsService(prisma, audit);

    await expect(service.create("missing-site", baseCreateDto, actor)).rejects.toThrow(NotFoundException);
  });

  it("rejects creating an asset with an equipmentTypeCode that doesn't exist", async () => {
    const prisma = mockOf<PrismaService>({
      site: { findUnique: jest.fn().mockResolvedValue({ id: "site-1" }) },
      equipmentType: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const service = new AssetsService(prisma, audit);

    await expect(service.create("site-1", baseCreateDto, actor)).rejects.toThrow(NotFoundException);
  });

  it("rejects capacityValue provided without capacityUnitCode", async () => {
    const prisma = mockOf<PrismaService>({
      site: { findUnique: jest.fn().mockResolvedValue({ id: "site-1" }) },
      equipmentType: { findUnique: jest.fn().mockResolvedValue({ code: "SPLIT_INDOOR" }) },
    });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const service = new AssetsService(prisma, audit);

    await expect(
      service.create("site-1", { ...baseCreateDto, capacityValue: 2 }, actor),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects capacityUnitCode provided without capacityValue", async () => {
    const prisma = mockOf<PrismaService>({
      site: { findUnique: jest.fn().mockResolvedValue({ id: "site-1" }) },
      equipmentType: { findUnique: jest.fn().mockResolvedValue({ code: "SPLIT_INDOOR" }) },
    });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const service = new AssetsService(prisma, audit);

    await expect(
      service.create("site-1", { ...baseCreateDto, capacityUnitCode: "TR" }, actor),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects a capacityUnitCode that doesn't exist", async () => {
    const prisma = mockOf<PrismaService>({
      site: { findUnique: jest.fn().mockResolvedValue({ id: "site-1" }) },
      equipmentType: { findUnique: jest.fn().mockResolvedValue({ code: "SPLIT_INDOOR" }) },
      capacityUnit: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const service = new AssetsService(prisma, audit);

    await expect(
      service.create("site-1", { ...baseCreateDto, capacityValue: 2, capacityUnitCode: "GHOST" }, actor),
    ).rejects.toThrow(NotFoundException);
  });

  it("rejects a duplicate assetTag at the same site with a clean 409", async () => {
    const prisma = mockOf<PrismaService>({
      site: { findUnique: jest.fn().mockResolvedValue({ id: "site-1" }) },
      equipmentType: { findUnique: jest.fn().mockResolvedValue({ code: "SPLIT_INDOOR" }) },
      asset: { findUnique: jest.fn().mockResolvedValue({ id: "existing-asset" }) },
    });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const service = new AssetsService(prisma, audit);

    await expect(service.create("site-1", baseCreateDto, actor)).rejects.toThrow(ConflictException);
  });

  it("rejects an equipmentSystemId that belongs to a different site", async () => {
    const prisma = mockOf<PrismaService>({
      site: { findUnique: jest.fn().mockResolvedValue({ id: "site-1" }) },
      equipmentType: { findUnique: jest.fn().mockResolvedValue({ code: "SPLIT_INDOOR" }) },
      equipmentSystem: { findUnique: jest.fn().mockResolvedValue({ id: "es1", siteId: "other-site" }) },
    });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const service = new AssetsService(prisma, audit);

    await expect(
      service.create("site-1", { ...baseCreateDto, equipmentSystemId: "es1" }, actor),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects a parentAssetId that belongs to a different site", async () => {
    const prisma = mockOf<PrismaService>({
      site: { findUnique: jest.fn().mockResolvedValue({ id: "site-1" }) },
      equipmentType: { findUnique: jest.fn().mockResolvedValue({ code: "SPLIT_INDOOR" }) },
      asset: { findUnique: jest.fn().mockResolvedValue({ id: "parent-1", siteId: "other-site" }) },
    });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const service = new AssetsService(prisma, audit);

    await expect(
      service.create("site-1", { ...baseCreateDto, parentAssetId: "parent-1" }, actor),
    ).rejects.toThrow(BadRequestException);
  });

  it("creates an asset with a valid capacity pair and audits asset_created", async () => {
    const created = {
      id: "a1",
      siteId: "site-1",
      assetTag: "AC-101-IDU",
      equipmentTypeCode: "SPLIT_INDOOR",
      status: AssetStatus.ACTIVE,
    };
    const prisma = mockOf<PrismaService>({
      site: { findUnique: jest.fn().mockResolvedValue({ id: "site-1" }) },
      equipmentType: { findUnique: jest.fn().mockResolvedValue({ code: "SPLIT_INDOOR" }) },
      capacityUnit: { findUnique: jest.fn().mockResolvedValue({ code: "TR" }) },
      asset: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(created),
      },
    });
    const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
    const service = new AssetsService(prisma, audit);

    const result = await service.create("site-1", { ...baseCreateDto, capacityValue: 2, capacityUnitCode: "TR" }, actor);

    expect(result).toBe(created);
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: "asset_created", entityType: "asset", entityId: "a1" }),
    );
  });

  it("update() audits only the fields the DTO actually changed", async () => {
    const before = {
      id: "a1",
      siteId: "site-1",
      assetTag: "AC-101-IDU",
      brand: "Old Brand",
      capacityValue: null,
      capacityUnitCode: null,
      status: AssetStatus.ACTIVE,
    };
    const after = { ...before, brand: "New Brand" };
    const prisma = mockOf<PrismaService>({
      asset: {
        findUnique: jest.fn().mockResolvedValue(before),
        update: jest.fn().mockResolvedValue(after),
      },
    });
    const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
    const service = new AssetsService(prisma, audit);

    await service.update("a1", { brand: "New Brand" }, actor);

    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "asset_updated",
        beforeData: { brand: "Old Brand" },
        afterData: { brand: "New Brand" },
      }),
    );
  });

  it("update() rejects clearing capacityValue while capacityUnitCode stays set from before (breaking the pair)", async () => {
    const before = {
      id: "a1",
      siteId: "site-1",
      assetTag: "AC-101-IDU",
      capacityValue: 2,
      capacityUnitCode: "TR",
      status: AssetStatus.ACTIVE,
    };
    const prisma = mockOf<PrismaService>({
      asset: { findUnique: jest.fn().mockResolvedValue(before) },
    });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const service = new AssetsService(prisma, audit);

    // capacityUnitCode is omitted entirely, so it stays "TR" from `before`;
    // capacityValue is explicitly cleared to null — the pair is now broken.
    await expect(
      service.update("a1", { capacityValue: null as unknown as number }, actor),
    ).rejects.toThrow(BadRequestException);
  });

  it("update() only re-checks assetTag availability when the tag is actually changing", async () => {
    const before = { id: "a1", siteId: "site-1", assetTag: "AC-101-IDU", status: AssetStatus.ACTIVE };
    const after = { ...before, brand: "New Brand" };
    const prisma = mockOf<PrismaService>({
      asset: {
        findUnique: jest.fn().mockResolvedValue(before),
        update: jest.fn().mockResolvedValue(after),
      },
    });
    const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
    const service = new AssetsService(prisma, audit);

    await service.update("a1", { assetTag: "AC-101-IDU", brand: "New Brand" }, actor);

    // findUnique on `asset` was only called once — the findByIdOrThrow — not
    // a second time for a tag-availability check, since the tag didn't change.
    expect(prisma.asset.findUnique).toHaveBeenCalledTimes(1);
  });

  it("moves ACTIVE -> OUT_OF_SERVICE and audits before/after status", async () => {
    const before = { id: "a1", status: AssetStatus.ACTIVE };
    const after = { ...before, status: AssetStatus.OUT_OF_SERVICE };
    const prisma = mockOf<PrismaService>({
      asset: {
        findUnique: jest.fn().mockResolvedValue(before),
        update: jest.fn().mockResolvedValue(after),
      },
    });
    const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
    const service = new AssetsService(prisma, audit);

    const result = await service.updateStatus("a1", AssetStatus.OUT_OF_SERVICE, actor);

    expect(result.status).toBe(AssetStatus.OUT_OF_SERVICE);
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "asset_status_changed",
        beforeData: { status: AssetStatus.ACTIVE },
        afterData: { status: AssetStatus.OUT_OF_SERVICE },
      }),
    );
  });

  describe("link()", () => {
    it("rejects an asset being linked as its own parent", async () => {
      const before = { id: "a1", siteId: "site-1" };
      const prisma = mockOf<PrismaService>({ asset: { findUnique: jest.fn().mockResolvedValue(before) } });
      const audit = mockOf<AuditService>({ write: jest.fn() });
      const service = new AssetsService(prisma, audit);

      await expect(service.link("a1", { parentAssetId: "a1" }, actor)).rejects.toThrow(BadRequestException);
    });

    it("rejects a parent asset from a different site", async () => {
      const before = { id: "a1", siteId: "site-1" };
      const prisma = mockOf<PrismaService>({
        asset: {
          findUnique: jest
            .fn()
            .mockResolvedValueOnce(before) // findByIdOrThrow
            .mockResolvedValueOnce({ id: "a2", siteId: "other-site" }), // parent lookup
        },
      });
      const audit = mockOf<AuditService>({ write: jest.fn() });
      const service = new AssetsService(prisma, audit);

      await expect(service.link("a1", { parentAssetId: "a2" }, actor)).rejects.toThrow(BadRequestException);
    });

    it("rejects an equipment system from a different site", async () => {
      const before = { id: "a1", siteId: "site-1" };
      const prisma = mockOf<PrismaService>({
        asset: { findUnique: jest.fn().mockResolvedValue(before) },
        equipmentSystem: { findUnique: jest.fn().mockResolvedValue({ id: "es1", siteId: "other-site" }) },
      });
      const audit = mockOf<AuditService>({ write: jest.fn() });
      const service = new AssetsService(prisma, audit);

      await expect(service.link("a1", { equipmentSystemId: "es1" }, actor)).rejects.toThrow(BadRequestException);
    });

    it("sets a valid parentAssetId within the same site and audits asset_regrouped", async () => {
      const before = { id: "a1", siteId: "site-1", parentAssetId: null };
      const after = { ...before, parentAssetId: "a2" };
      const prisma = mockOf<PrismaService>({
        asset: {
          findUnique: jest
            .fn()
            .mockResolvedValueOnce(before) // findByIdOrThrow
            .mockResolvedValueOnce({ id: "a2", siteId: "site-1" }), // parent lookup
          update: jest.fn().mockResolvedValue(after),
        },
      });
      const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
      const service = new AssetsService(prisma, audit);

      const result = await service.link("a1", { parentAssetId: "a2" }, actor);

      expect(result.parentAssetId).toBe("a2");
      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "asset_regrouped",
          beforeData: { parentAssetId: null },
          afterData: { parentAssetId: "a2" },
        }),
      );
    });

    it("clears an existing link when explicitly sent null, without a lookup", async () => {
      const before = { id: "a1", siteId: "site-1", parentAssetId: "a2" };
      const after = { ...before, parentAssetId: null };
      const prisma = mockOf<PrismaService>({
        asset: {
          findUnique: jest.fn().mockResolvedValue(before),
          update: jest.fn().mockResolvedValue(after),
        },
      });
      const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
      const service = new AssetsService(prisma, audit);

      const result = await service.link("a1", { parentAssetId: null }, actor);

      expect(result.parentAssetId).toBeNull();
      // findUnique on `asset` was only called once — the findByIdOrThrow —
      // clearing a link (null) never triggers the parent-lookup validation.
      expect(prisma.asset.findUnique).toHaveBeenCalledTimes(1);
      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({ action: "asset_regrouped", afterData: { parentAssetId: null } }),
      );
    });
  });

  it("findByIdOrThrow throws NotFoundException for a missing asset", async () => {
    const prisma = mockOf<PrismaService>({ asset: { findUnique: jest.fn().mockResolvedValue(null) } });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const service = new AssetsService(prisma, audit);

    await expect(service.findByIdOrThrow("missing")).rejects.toThrow(NotFoundException);
  });
});
