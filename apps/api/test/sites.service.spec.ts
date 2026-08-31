import { SiteStatus } from "@prisma/client";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { SitesService } from "../src/modules/customers/sites.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { AuditService } from "../src/modules/audit/audit.service";
import { mockOf } from "./test-utils";

const actor = { userId: "actor-1", ipAddress: "127.0.0.1", userAgent: "jest" };

describe("SitesService — status is the only lifecycle mechanism (no delete)", () => {
  it("has no delete method — deactivation is the only path", () => {
    const methodNames = Object.getOwnPropertyNames(SitesService.prototype);
    expect(methodNames).not.toContain("delete");
    expect(methodNames).not.toContain("remove");
  });

  it("rejects creating a site under a customer that doesn't exist", async () => {
    const prisma = mockOf<PrismaService>({
      customer: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const service = new SitesService(prisma, audit);

    await expect(
      service.create("missing-customer", { label: "HQ", addressLine: "123 Main St" }, actor),
    ).rejects.toThrow(NotFoundException);
  });

  it("rejects a primaryContactId that belongs to a different customer", async () => {
    const prisma = mockOf<PrismaService>({
      customer: { findUnique: jest.fn().mockResolvedValue({ id: "cust-1" }) },
      contact: { findUnique: jest.fn().mockResolvedValue({ id: "ct-1", customerId: "some-other-customer" }) },
    });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const service = new SitesService(prisma, audit);

    await expect(
      service.create("cust-1", { label: "HQ", addressLine: "123 Main St", primaryContactId: "ct-1" }, actor),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects a primaryContactId that doesn't exist at all", async () => {
    const prisma = mockOf<PrismaService>({
      customer: { findUnique: jest.fn().mockResolvedValue({ id: "cust-1" }) },
      contact: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const service = new SitesService(prisma, audit);

    await expect(
      service.create("cust-1", { label: "HQ", addressLine: "123 Main St", primaryContactId: "ghost" }, actor),
    ).rejects.toThrow(NotFoundException);
  });

  it("creates a site and audits site_created", async () => {
    const created = { id: "s1", customerId: "cust-1", label: "HQ", status: SiteStatus.ACTIVE };
    const prisma = mockOf<PrismaService>({
      customer: { findUnique: jest.fn().mockResolvedValue({ id: "cust-1" }) },
      site: { create: jest.fn().mockResolvedValue(created) },
    });
    const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
    const service = new SitesService(prisma, audit);

    const result = await service.create("cust-1", { label: "HQ", addressLine: "123 Main St" }, actor);

    expect(result).toBe(created);
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: "site_created", entityType: "site", entityId: "s1" }),
    );
  });

  it("update() audits only the fields the DTO actually changed", async () => {
    const before = { id: "s1", customerId: "cust-1", label: "Old Label", status: SiteStatus.ACTIVE };
    const after = { ...before, label: "New Label" };
    const prisma = mockOf<PrismaService>({
      site: {
        findUnique: jest.fn().mockResolvedValue(before),
        update: jest.fn().mockResolvedValue(after),
      },
    });
    const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
    const service = new SitesService(prisma, audit);

    await service.update("s1", { label: "New Label" }, actor);

    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "site_updated",
        beforeData: { label: "Old Label" },
        afterData: { label: "New Label" },
      }),
    );
  });

  it("update() validates primaryContactId against the site's existing customer, not any DTO field", async () => {
    const before = { id: "s1", customerId: "cust-1", label: "HQ", status: SiteStatus.ACTIVE };
    const prisma = mockOf<PrismaService>({
      site: { findUnique: jest.fn().mockResolvedValue(before) },
      contact: { findUnique: jest.fn().mockResolvedValue({ id: "ct-1", customerId: "different-customer" }) },
    });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const service = new SitesService(prisma, audit);

    await expect(service.update("s1", { primaryContactId: "ct-1" }, actor)).rejects.toThrow(BadRequestException);
  });

  it("moves ACTIVE -> INACTIVE without touching any other field, and audits before/after status", async () => {
    const before = { id: "s1", customerId: "cust-1", label: "HQ", status: SiteStatus.ACTIVE };
    const after = { ...before, status: SiteStatus.INACTIVE };
    const prisma = mockOf<PrismaService>({
      site: {
        findUnique: jest.fn().mockResolvedValue(before),
        update: jest.fn().mockResolvedValue(after),
      },
    });
    const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
    const service = new SitesService(prisma, audit);

    const result = await service.updateStatus("s1", SiteStatus.INACTIVE, actor);

    expect(result.status).toBe(SiteStatus.INACTIVE);
    expect(prisma.site.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "s1" }, data: { status: SiteStatus.INACTIVE } }),
    );
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "site_status_changed",
        beforeData: { status: SiteStatus.ACTIVE },
        afterData: { status: SiteStatus.INACTIVE },
      }),
    );
  });

  it("findByIdOrThrow throws NotFoundException for a missing site", async () => {
    const prisma = mockOf<PrismaService>({ site: { findUnique: jest.fn().mockResolvedValue(null) } });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const service = new SitesService(prisma, audit);

    await expect(service.findByIdOrThrow("missing")).rejects.toThrow(NotFoundException);
  });
});
