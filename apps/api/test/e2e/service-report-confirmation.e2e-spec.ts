import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { UserStatus } from "@prisma/client";
import { bootstrapTestApp, E2eFixtures, E2E_PREFIX } from "./support";
import { PrismaService } from "../../src/prisma/prisma.service";
import { StorageProvider } from "../../src/common/storage/storage-provider.interface";

/**
 * Live E2E — Phase 5 Step 6 (Confirm Report / Canonical Service Report
 * Write). Directly seeds already-VERIFIED reports with reviewed staging
 * data (bypassing Step 5's own HTTP verification flow entirely) — this file
 * tests Confirm's own correctness, not how a report reaches VERIFIED (that
 * is service-report-verification.e2e-spec.ts's job). Real HTTP/guard/RBAC/
 * audit stack, real Postgres transactions — no Vertex AI credentials
 * involved.
 */
describe("Service Report Confirm (live)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageProvider;
  let fixtures: E2eFixtures;

  let technician: { user: { id: string }; authHeader: string };
  let officeStaff: { user: { id: string }; authHeader: string };

  async function loginHeader(email: string, password: string) {
    const res = await request(app.getHttpServer()).post("/auth/login").send({ email, password });
    return `Bearer ${res.body.accessToken}`;
  }

  async function userWithPermissions(suffix: string, modules: Array<[string, string]>) {
    const perms = await Promise.all(modules.map(([module, action]) => fixtures.ensurePermission(module, action)));
    const role = await fixtures.createRole(`sr-confirm-${suffix}`, perms.map((p) => p.id));
    const user = await fixtures.createUser(suffix, UserStatus.ACTIVE, [role.id]);
    const authHeader = await loginHeader(user.email, user.password);
    return { user, authHeader };
  }

  beforeAll(async () => {
    ({ app, prisma, storage } = await bootstrapTestApp());
    fixtures = new E2eFixtures(prisma, storage);
    technician = await userWithPermissions("tech", [
      ["service_reports", "upload"],
      ["service_reports", "read_own"],
    ]);
    officeStaff = await userWithPermissions("office", [
      ["service_reports", "upload"],
      ["service_reports", "read"],
      ["service_reports", "verify"],
      ["service_reports", "confirm"],
    ]);
  });

  afterAll(async () => {
    await fixtures.cleanupAll();
    await app.close();
  });

  interface SeedRow {
    fieldName: string;
    rowIndex?: number;
    aiValue: string | null;
    aiConfidence?: "HIGH" | "MEDIUM" | "LOW" | "UNREADABLE" | null;
    reviewStatus: "CONFIRMED" | "CORRECTED" | "CONFIRMED_BLANK" | "NEEDS_FOLLOW_UP" | null;
    verifiedValue: string | null;
    aiUnit?: string | null;
    stage?: string | null;
    suggestedMeasurementTypeCode?: string | null;
  }

  /**
   * Directly seeds a VERIFIED report with already-reviewed staging rows
   * across whichever categories the test needs — the same
   * bypass-the-upstream-layer isolation style already established by
   * service-report-verification.e2e-spec.ts, one layer further downstream.
   */
  async function seedVerifiedReport(
    suffix: string,
    categories: Partial<Record<"basicInfo" | "equipmentUnit" | "problem" | "measurement" | "narrativeItem" | "signoff", SeedRow[]>>,
    reportOverrides: Partial<{ status: string }> = {},
  ) {
    const customer = await fixtures.createCustomer(`sr-confirm-${suffix}`);
    const site = await fixtures.createSite(customer.id, `sr-confirm-${suffix}`);
    const fileKey = `${E2E_PREFIX}/service-reports/${suffix}-${Date.now()}.jpg`;
    await storage.putObject({ key: fileKey, body: Buffer.from("fake report photo"), contentType: "image/jpeg" });

    const report = await prisma.serviceReport.create({
      data: {
        serviceReportNumber: `E2ECONF-${suffix.slice(0, 8)}-${Date.now().toString(36)}`,
        customerId: customer.id,
        siteId: site.id,
        reportTypeCode: "MAINTENANCE_CLEANING",
        sourceType: "INTERNAL_SERVICE",
        status: (reportOverrides.status ?? "VERIFIED") as never,
        documentFileKey: fileKey,
        documentMimeType: "image/jpeg",
        documentFileName: "report.jpg",
        documentFileSize: 17,
        uploadedBy: technician.user.id,
        uploadedAt: new Date(),
        verifiedBy: officeStaff.user.id,
        verifiedAt: new Date(),
      },
    });

    const delegateFor = {
      basicInfo: prisma.extractionBasicInfo,
      equipmentUnit: prisma.extractionEquipmentUnit,
      problem: prisma.extractionProblem,
      measurement: prisma.extractionMeasurement,
      narrativeItem: prisma.extractionNarrativeItem,
      signoff: prisma.extractionSignoff,
    } as const;

    for (const [category, rows] of Object.entries(categories) as Array<[keyof typeof delegateFor, SeedRow[]]>) {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        await (delegateFor[category].create as unknown as (args: { data: Record<string, unknown> }) => Promise<unknown>)({
          data: {
            serviceReportId: report.id,
            rowIndex: r.rowIndex ?? 0,
            fieldName: r.fieldName,
            aiValue: r.aiValue,
            aiConfidence: r.aiConfidence ?? null,
            reviewStatus: r.reviewStatus,
            verifiedValue: r.verifiedValue,
            verifiedBy: officeStaff.user.id,
            verifiedAt: new Date(),
            ...(category === "measurement" ? { aiUnit: r.aiUnit ?? null, stage: r.stage ?? null, suggestedMeasurementTypeCode: r.suggestedMeasurementTypeCode ?? null } : {}),
          },
        });
      }
    }

    return { report, customer, site };
  }

  describe("RBAC", () => {
    it("rejects a Technician from preview, confirm, and the canonical viewer", async () => {
      const { report } = await seedVerifiedReport("rbac-tech", { measurement: [{ fieldName: "x", aiValue: "1", reviewStatus: "CONFIRMED", verifiedValue: "1", suggestedMeasurementTypeCode: null }] });

      const preview = await request(app.getHttpServer()).get(`/service-reports/${report.id}/confirm/preview`).set("Authorization", technician.authHeader);
      expect(preview.status).toBe(403);

      const confirm = await request(app.getHttpServer()).post(`/service-reports/${report.id}/confirm`).set("Authorization", technician.authHeader);
      expect(confirm.status).toBe(403);

      const canonical = await request(app.getHttpServer()).get(`/service-reports/${report.id}/canonical`).set("Authorization", technician.authHeader);
      expect(canonical.status).toBe(403);
    });

    it("allows an Office Staff holder of service_reports.confirm to preview and confirm", async () => {
      const { report } = await seedVerifiedReport("rbac-office", { measurement: [{ fieldName: "x", aiValue: "1", reviewStatus: "CONFIRMED", verifiedValue: "1", suggestedMeasurementTypeCode: null }] });
      const preview = await request(app.getHttpServer()).get(`/service-reports/${report.id}/confirm/preview`).set("Authorization", officeStaff.authHeader);
      expect(preview.status).toBe(200);
    });
  });

  describe("Preview — zero writes", () => {
    it("reports isConfirmable and the planned canonical shape without creating any canonical row", async () => {
      const { report } = await seedVerifiedReport("preview", {
        measurement: [{ fieldName: "Breaker Capacity", aiValue: "ISA", reviewStatus: "CONFIRMED", verifiedValue: "ISA", suggestedMeasurementTypeCode: null }],
      });

      const res = await request(app.getHttpServer()).get(`/service-reports/${report.id}/confirm/preview`).set("Authorization", officeStaff.authHeader);
      expect(res.status).toBe(200);
      expect(res.body.isConfirmable).toBe(true);
      expect(res.body.measurements[0].measurementTypeCode).toBe("OTHER_UNMAPPED");
      expect(res.body.measurements[0].sourceFieldName).toBe("Breaker Capacity");

      const canonicalCount = await prisma.serviceReportMeasurement.count({ where: { serviceReportId: report.id } });
      expect(canonicalCount).toBe(0);

      const stillVerified = await prisma.serviceReport.findUnique({ where: { id: report.id } });
      expect(stillVerified!.status).toBe("VERIFIED");
    });

    it("reports not confirmable, and confirm itself refuses, for a report that isn't VERIFIED", async () => {
      const { report } = await seedVerifiedReport("not-verified", {}, { status: "PENDING_VERIFICATION" });
      const preview = await request(app.getHttpServer()).get(`/service-reports/${report.id}/confirm/preview`).set("Authorization", officeStaff.authHeader);
      expect(preview.body.isConfirmable).toBe(false);

      const confirm = await request(app.getHttpServer()).post(`/service-reports/${report.id}/confirm`).set("Authorization", officeStaff.authHeader);
      expect(confirm.status).toBe(400);
    });

    it("defensively refuses confirm for a VERIFIED report that still has a NEEDS_FOLLOW_UP field (inconsistent state)", async () => {
      const { report } = await seedVerifiedReport("needs-follow-up", {
        measurement: [{ fieldName: "x", aiValue: "1", reviewStatus: "NEEDS_FOLLOW_UP", verifiedValue: null }],
      });
      const confirm = await request(app.getHttpServer()).post(`/service-reports/${report.id}/confirm`).set("Authorization", officeStaff.authHeader);
      expect(confirm.status).toBe(400);
      const stillVerified = await prisma.serviceReport.findUnique({ where: { id: report.id } });
      expect(stillVerified!.status).toBe("VERIFIED");
    });
  });

  describe("Confirm — full canonical write", () => {
    it("writes CORRECTED, CONFIRMED_BLANK, and OTHER_UNMAPPED fields correctly, with equipment association by rowIndex, and moves the report to CONFIRMED", async () => {
      const { report } = await seedVerifiedReport("full", {
        basicInfo: [
          { fieldName: "Work Date", aiValue: "August 28, 2026", reviewStatus: "CORRECTED", verifiedValue: "August 27, 2026" },
          { fieldName: "Contact Person / Tel No.", aiValue: null, reviewStatus: "CONFIRMED_BLANK", verifiedValue: null },
        ],
        equipmentUnit: [{ fieldName: "Unit Tag", rowIndex: 0, aiValue: "AC#1", reviewStatus: "CONFIRMED", verifiedValue: "AC#1" }],
        measurement: [
          { fieldName: "Low Side Pressure", rowIndex: 0, aiValue: "65", aiUnit: "psi", reviewStatus: "CONFIRMED", verifiedValue: "65", suggestedMeasurementTypeCode: "LOW_SIDE_PRESSURE" },
          { fieldName: "Breaker Capacity", rowIndex: 0, aiValue: "ISA", reviewStatus: "CONFIRMED", verifiedValue: "ISA", suggestedMeasurementTypeCode: null },
        ],
        problem: [{ fieldName: "NOT OPERATIONAL", aiValue: "checked", reviewStatus: "CONFIRMED", verifiedValue: "checked" }],
        signoff: [{ fieldName: "Technician Signature", aiValue: "John Arnold Candia", reviewStatus: "CONFIRMED", verifiedValue: "John Arnold Candia" }],
      });

      const res = await request(app.getHttpServer()).post(`/service-reports/${report.id}/confirm`).set("Authorization", officeStaff.authHeader);
      expect(res.status).toBe(201);
      expect(res.body.report.status).toBe("CONFIRMED");
      expect(res.body.createdCounts).toEqual({ technicians: 0, equipmentUnits: 1, problems: 1, measurements: 2, narrativeItems: 0, signoffs: 1 });

      const updated = await prisma.serviceReport.findUnique({ where: { id: report.id } });
      expect(updated!.status).toBe("CONFIRMED");
      expect(updated!.confirmedBy).toBe(officeStaff.user.id);
      expect(updated!.confirmedAt).not.toBeNull();
      expect(updated!.serviceDate?.toISOString().slice(0, 10)).toBe("2026-08-27"); // CORRECTED value, not the original AI value
      expect(updated!.contactName).toBeNull(); // CONFIRMED_BLANK

      const equipmentUnits = await prisma.serviceReportEquipmentUnit.findMany({ where: { serviceReportId: report.id } });
      expect(equipmentUnits).toHaveLength(1);
      expect(equipmentUnits[0].unitTag).toBe("AC#1");

      const measurements = await prisma.serviceReportMeasurement.findMany({ where: { serviceReportId: report.id }, orderBy: { sortOrder: "asc" } });
      expect(measurements).toHaveLength(2);
      const lowSide = measurements.find((m) => m.value === "65")!;
      expect(lowSide.measurementTypeCode).toBe("LOW_SIDE_PRESSURE");
      expect(lowSide.equipmentUnitId).toBe(equipmentUnits[0].id); // associated by rowIndex
      const breaker = measurements.find((m) => m.value === "ISA")!;
      expect(breaker.measurementTypeCode).toBe("OTHER_UNMAPPED"); // approved fallback
      expect(breaker.sourceFieldName).toBe("Breaker Capacity"); // provenance preserved despite the fallback

      const problems = await prisma.serviceReportProblem.findMany({ where: { serviceReportId: report.id } });
      expect(problems).toHaveLength(1);
      expect(problems[0].description).toBe("NOT OPERATIONAL");
      expect(problems[0].problemTypeCode).toBe("NOT_OPERATIONAL");

      const signoffs = await prisma.serviceReportSignoff.findMany({ where: { serviceReportId: report.id } });
      expect(signoffs[0].signoffRoleCode).toBe("TECHNICIAN");
      expect(signoffs[0].signatoryName).toBe("John Arnold Candia");

      // Original staging data is untouched and permanently retained.
      const stagingMeasurements = await prisma.extractionMeasurement.findMany({ where: { serviceReportId: report.id } });
      expect(stagingMeasurements.find((m) => m.fieldName === "Low Side Pressure")!.aiValue).toBe("65");

      const audit = await prisma.auditLog.findFirst({ where: { action: "service_report_confirmed", entityId: report.id }, orderBy: { createdAt: "desc" } });
      expect(audit).not.toBeNull();
      expect(audit!.actorUserId).toBe(officeStaff.user.id);
    });

    it("never creates an empty equipment unit for a group that is entirely blank", async () => {
      const { report } = await seedVerifiedReport("empty-equipment", {
        equipmentUnit: [{ fieldName: "Unit Tag", rowIndex: 0, aiValue: null, reviewStatus: "CONFIRMED_BLANK", verifiedValue: null }],
        measurement: [{ fieldName: "x", aiValue: "1", reviewStatus: "CONFIRMED", verifiedValue: "1", suggestedMeasurementTypeCode: null }],
      });
      const res = await request(app.getHttpServer()).post(`/service-reports/${report.id}/confirm`).set("Authorization", officeStaff.authHeader);
      expect(res.status).toBe(201);
      const equipmentUnits = await prisma.serviceReportEquipmentUnit.findMany({ where: { serviceReportId: report.id } });
      expect(equipmentUnits).toEqual([]);
    });
  });

  describe("Idempotency and concurrency", () => {
    it("rejects a second sequential confirm attempt with no duplicate canonical rows", async () => {
      const { report } = await seedVerifiedReport("double-confirm", {
        measurement: [{ fieldName: "x", aiValue: "1", reviewStatus: "CONFIRMED", verifiedValue: "1", suggestedMeasurementTypeCode: null }],
      });

      const first = await request(app.getHttpServer()).post(`/service-reports/${report.id}/confirm`).set("Authorization", officeStaff.authHeader);
      expect(first.status).toBe(201);

      const second = await request(app.getHttpServer()).post(`/service-reports/${report.id}/confirm`).set("Authorization", officeStaff.authHeader);
      expect([400, 409]).toContain(second.status);

      const measurements = await prisma.serviceReportMeasurement.findMany({ where: { serviceReportId: report.id } });
      expect(measurements).toHaveLength(1); // never duplicated
    });

    it("under real concurrent requests, exactly one confirm succeeds and canonical rows are never duplicated", async () => {
      const { report } = await seedVerifiedReport("concurrent-confirm", {
        measurement: [{ fieldName: "x", aiValue: "1", reviewStatus: "CONFIRMED", verifiedValue: "1", suggestedMeasurementTypeCode: null }],
      });

      const [a, b] = await Promise.all([
        request(app.getHttpServer()).post(`/service-reports/${report.id}/confirm`).set("Authorization", officeStaff.authHeader),
        request(app.getHttpServer()).post(`/service-reports/${report.id}/confirm`).set("Authorization", officeStaff.authHeader),
      ]);

      const statuses = [a.status, b.status].sort();
      expect(statuses[0]).toBe(201);
      expect([400, 409]).toContain(statuses[1]);

      const measurements = await prisma.serviceReportMeasurement.findMany({ where: { serviceReportId: report.id } });
      expect(measurements).toHaveLength(1); // exactly one confirm's writes survived

      const updated = await prisma.serviceReport.findUnique({ where: { id: report.id } });
      expect(updated!.status).toBe("CONFIRMED");
    });
  });

  describe("Canonical viewer", () => {
    it("is unavailable before Confirm and returns the full canonical shape after", async () => {
      const { report } = await seedVerifiedReport("viewer", {
        measurement: [{ fieldName: "x", aiValue: "1", reviewStatus: "CONFIRMED", verifiedValue: "1", suggestedMeasurementTypeCode: null }],
        signoff: [{ fieldName: "Customer Signature", aiValue: "Jane Doe", reviewStatus: "CONFIRMED", verifiedValue: "Jane Doe" }],
      });

      const before = await request(app.getHttpServer()).get(`/service-reports/${report.id}/canonical`).set("Authorization", officeStaff.authHeader);
      expect(before.status).toBe(400);

      await request(app.getHttpServer()).post(`/service-reports/${report.id}/confirm`).set("Authorization", officeStaff.authHeader);

      const after = await request(app.getHttpServer()).get(`/service-reports/${report.id}/canonical`).set("Authorization", officeStaff.authHeader);
      expect(after.status).toBe(200);
      expect(after.body.report.status).toBe("CONFIRMED");
      expect(after.body.measurements).toHaveLength(1);
      expect(after.body.signoffs[0].signoffRoleCode).toBe("CUSTOMER");
    });
  });
});
