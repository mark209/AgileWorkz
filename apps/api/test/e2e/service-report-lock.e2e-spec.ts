import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { UserStatus } from "@prisma/client";
import { bootstrapTestApp, E2eFixtures, E2E_PREFIX } from "./support";
import { PrismaService } from "../../src/prisma/prisma.service";
import { StorageProvider } from "../../src/common/storage/storage-provider.interface";

/**
 * Live E2E — Phase 5 Step 7 (Lock). Directly seeds already-CONFIRMED
 * reports (bypassing Confirm's own HTTP flow entirely — that is
 * service-report-confirmation.e2e-spec.ts's job) — this file tests Lock's
 * own correctness in isolation. Real HTTP/guard/RBAC/audit stack, real
 * Postgres transactions.
 */
describe("Service Report Lock (live)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageProvider;
  let fixtures: E2eFixtures;

  let technician: { user: { id: string }; authHeader: string };
  let officeStaff: { user: { id: string }; authHeader: string };
  let manager: { user: { id: string }; authHeader: string };

  async function loginHeader(email: string, password: string) {
    const res = await request(app.getHttpServer()).post("/auth/login").send({ email, password });
    return `Bearer ${res.body.accessToken}`;
  }

  async function userWithPermissions(suffix: string, modules: Array<[string, string]>) {
    const perms = await Promise.all(modules.map(([module, action]) => fixtures.ensurePermission(module, action)));
    const role = await fixtures.createRole(`sr-lock-${suffix}`, perms.map((p) => p.id));
    const user = await fixtures.createUser(suffix, UserStatus.ACTIVE, [role.id]);
    const authHeader = await loginHeader(user.email, user.password);
    return { user, authHeader };
  }

  beforeAll(async () => {
    ({ app, prisma, storage } = await bootstrapTestApp());
    fixtures = new E2eFixtures(prisma, storage);
    // Matches the approved RBAC model exactly: Technician and Office Staff
    // (even one who CAN confirm) must not be able to lock; only a
    // service_reports.lock holder (Manager/Admin-Owner in production) can.
    technician = await userWithPermissions("tech", [
      ["service_reports", "upload"],
      ["service_reports", "read_own"],
    ]);
    officeStaff = await userWithPermissions("office", [
      ["service_reports", "upload"],
      ["service_reports", "read"],
      ["service_reports", "confirm"],
    ]);
    manager = await userWithPermissions("manager", [
      ["service_reports", "read"],
      ["service_reports", "confirm"],
      ["service_reports", "lock"],
    ]);
  });

  afterAll(async () => {
    await fixtures.cleanupAll();
    await app.close();
  });

  /**
   * Directly seeds a CONFIRMED report with one canonical equipment unit and
   * one still-intact staging row — enough to assert "nothing else changed"
   * before/after Lock.
   */
  async function seedConfirmedReport(suffix: string, statusOverride?: string) {
    const customer = await fixtures.createCustomer(`sr-lock-${suffix}`);
    const site = await fixtures.createSite(customer.id, `sr-lock-${suffix}`);
    const fileKey = `${E2E_PREFIX}/service-reports/${suffix}-${Date.now()}.jpg`;
    await storage.putObject({ key: fileKey, body: Buffer.from("fake report photo"), contentType: "image/jpeg" });

    const report = await prisma.serviceReport.create({
      data: {
        serviceReportNumber: `E2ELOCK-${suffix.slice(0, 8)}-${Date.now().toString(36)}`,
        customerId: customer.id,
        siteId: site.id,
        reportTypeCode: "MAINTENANCE_CLEANING",
        sourceType: "INTERNAL_SERVICE",
        status: (statusOverride ?? "CONFIRMED") as never,
        documentFileKey: fileKey,
        documentMimeType: "image/jpeg",
        documentFileName: "report.jpg",
        documentFileSize: 17,
        uploadedBy: technician.user.id,
        uploadedAt: new Date(),
        verifiedBy: manager.user.id,
        verifiedAt: new Date(),
        confirmedBy: statusOverride ? null : manager.user.id,
        confirmedAt: statusOverride ? null : new Date(),
      },
    });

    const equipmentUnit = await prisma.serviceReportEquipmentUnit.create({
      data: { serviceReportId: report.id, equipmentTypeCode: "OTHER", unitTag: "AC#1", description: "Split unit" },
    });
    const stagingRow = await prisma.extractionMeasurement.create({
      data: {
        serviceReportId: report.id, rowIndex: 0, fieldName: "Low Side Pressure", aiValue: "65", aiConfidence: "HIGH",
        reviewStatus: "CONFIRMED", verifiedValue: "65", verifiedBy: manager.user.id, verifiedAt: new Date(),
      },
    });

    return { report, equipmentUnit, stagingRow };
  }

  describe("RBAC", () => {
    it("rejects a Technician from locking", async () => {
      const { report } = await seedConfirmedReport("rbac-tech");
      const res = await request(app.getHttpServer()).post(`/service-reports/${report.id}/lock`).set("Authorization", technician.authHeader);
      expect(res.status).toBe(403);
    });

    it("rejects an Office Staff (even one who can confirm) from locking", async () => {
      const { report } = await seedConfirmedReport("rbac-office");
      const res = await request(app.getHttpServer()).post(`/service-reports/${report.id}/lock`).set("Authorization", officeStaff.authHeader);
      expect(res.status).toBe(403);
    });

    it("allows a service_reports.lock holder (Manager/Admin-Owner equivalent) to lock", async () => {
      const { report } = await seedConfirmedReport("rbac-manager");
      const res = await request(app.getHttpServer()).post(`/service-reports/${report.id}/lock`).set("Authorization", manager.authHeader);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("LOCKED");
    });
  });

  describe("Transition rule", () => {
    it("refuses to lock a report that isn't CONFIRMED", async () => {
      const { report } = await seedConfirmedReport("not-confirmed", "VERIFIED");
      const res = await request(app.getHttpServer()).post(`/service-reports/${report.id}/lock`).set("Authorization", manager.authHeader);
      expect(res.status).toBe(400);
      const stillVerified = await prisma.serviceReport.findUnique({ where: { id: report.id } });
      expect(stillVerified!.status).toBe("VERIFIED");
    });

    it("returns 404 for a non-existent report", async () => {
      const res = await request(app.getHttpServer())
        .post("/service-reports/00000000-0000-0000-0000-000000000000/lock")
        .set("Authorization", manager.authHeader);
      expect(res.status).toBe(404);
    });
  });

  describe("Lock sets lockedBy/lockedAt, writes audit, and touches nothing else", () => {
    it("sets status/lockedBy/lockedAt, writes a service_report_locked audit entry, and leaves canonical + staging data byte-for-byte unchanged", async () => {
      const { report, equipmentUnit, stagingRow } = await seedConfirmedReport("full");
      const beforeEquipment = await prisma.serviceReportEquipmentUnit.findUnique({ where: { id: equipmentUnit.id } });
      const beforeStaging = await prisma.extractionMeasurement.findUnique({ where: { id: stagingRow.id } });

      const res = await request(app.getHttpServer()).post(`/service-reports/${report.id}/lock`).set("Authorization", manager.authHeader);
      expect(res.status).toBe(201);

      const updated = await prisma.serviceReport.findUnique({ where: { id: report.id } });
      expect(updated!.status).toBe("LOCKED");
      expect(updated!.lockedBy).toBe(manager.user.id);
      expect(updated!.lockedAt).not.toBeNull();
      // confirmedBy/confirmedAt from the prior step remain untouched.
      expect(updated!.confirmedBy).toBe(manager.user.id);

      const audit = await prisma.auditLog.findFirst({ where: { action: "service_report_locked", entityId: report.id }, orderBy: { createdAt: "desc" } });
      expect(audit).not.toBeNull();
      expect(audit!.actorUserId).toBe(manager.user.id);
      expect(audit!.beforeData).toEqual({ status: "CONFIRMED" });
      expect(audit!.afterData).toEqual({ status: "LOCKED" });

      const afterEquipment = await prisma.serviceReportEquipmentUnit.findUnique({ where: { id: equipmentUnit.id } });
      expect(afterEquipment).toEqual(beforeEquipment); // canonical child row byte-for-byte unchanged

      const afterStaging = await prisma.extractionMeasurement.findUnique({ where: { id: stagingRow.id } });
      expect(afterStaging).toEqual(beforeStaging); // staging row byte-for-byte unchanged
    });
  });

  describe("Canonical viewer after Lock", () => {
    it("remains fully readable and read-only after Lock", async () => {
      const { report } = await seedConfirmedReport("viewer");
      await request(app.getHttpServer()).post(`/service-reports/${report.id}/lock`).set("Authorization", manager.authHeader);

      const res = await request(app.getHttpServer()).get(`/service-reports/${report.id}/canonical`).set("Authorization", officeStaff.authHeader);
      expect(res.status).toBe(200);
      expect(res.body.report.status).toBe("LOCKED");
      expect(res.body.equipmentUnits).toHaveLength(1);
    });
  });

  describe("Idempotency and concurrency", () => {
    it("rejects a second sequential lock attempt", async () => {
      const { report } = await seedConfirmedReport("double-lock");
      const first = await request(app.getHttpServer()).post(`/service-reports/${report.id}/lock`).set("Authorization", manager.authHeader);
      expect(first.status).toBe(201);

      const second = await request(app.getHttpServer()).post(`/service-reports/${report.id}/lock`).set("Authorization", manager.authHeader);
      expect([400, 409]).toContain(second.status);

      const auditCount = await prisma.auditLog.count({ where: { action: "service_report_locked", entityId: report.id } });
      expect(auditCount).toBe(1); // never double-logged
    });

    it("under real concurrent requests, exactly one lock succeeds", async () => {
      const { report } = await seedConfirmedReport("concurrent-lock");

      const [a, b] = await Promise.all([
        request(app.getHttpServer()).post(`/service-reports/${report.id}/lock`).set("Authorization", manager.authHeader),
        request(app.getHttpServer()).post(`/service-reports/${report.id}/lock`).set("Authorization", manager.authHeader),
      ]);

      const statuses = [a.status, b.status].sort();
      expect(statuses[0]).toBe(201);
      expect([400, 409]).toContain(statuses[1]);

      const updated = await prisma.serviceReport.findUnique({ where: { id: report.id } });
      expect(updated!.status).toBe("LOCKED");

      const auditCount = await prisma.auditLog.count({ where: { action: "service_report_locked", entityId: report.id } });
      expect(auditCount).toBe(1); // exactly one lock's audit entry survived
    });
  });
});
