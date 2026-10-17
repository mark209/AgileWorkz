import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { UserStatus } from "@prisma/client";
import { bootstrapTestApp, E2eFixtures, E2E_PREFIX } from "./support";
import { PrismaService } from "../../src/prisma/prisma.service";
import { StorageProvider } from "../../src/common/storage/storage-provider.interface";

/**
 * Live E2E — Phase 5 Step 5 (Human Verification Workflow). Exercises the
 * real HTTP/guard/RBAC/audit stack against directly-seeded staging data
 * (bypassing the real extraction pipeline/queue entirely — this file tests
 * the verification workflow that CONSUMES staged data, not how it got
 * there; the extraction pipeline itself is covered by
 * service-report-extraction.e2e-spec.ts). No Vertex AI credentials
 * involved.
 */
describe("Service Report Human Verification Workflow (live)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageProvider;
  let fixtures: E2eFixtures;

  let technician: { user: { id: string }; authHeader: string };
  let officeStaff: { user: { id: string }; authHeader: string };
  let managerNoVerify: { user: { id: string }; authHeader: string };

  async function loginHeader(email: string, password: string) {
    const res = await request(app.getHttpServer()).post("/auth/login").send({ email, password });
    return `Bearer ${res.body.accessToken}`;
  }

  async function userWithPermissions(suffix: string, modules: Array<[string, string]>) {
    const perms = await Promise.all(modules.map(([module, action]) => fixtures.ensurePermission(module, action)));
    const role = await fixtures.createRole(`sr-verify-${suffix}`, perms.map((p) => p.id));
    const user = await fixtures.createUser(suffix, UserStatus.ACTIVE, [role.id]);
    const authHeader = await loginHeader(user.email, user.password);
    return { user, authHeader };
  }

  beforeAll(async () => {
    ({ app, prisma, storage } = await bootstrapTestApp());
    fixtures = new E2eFixtures(prisma, storage);
    // Technician: upload + read_own only — no verify permission at all,
    // matching the approved role matrix exactly.
    technician = await userWithPermissions("tech", [
      ["service_reports", "upload"],
      ["service_reports", "read_own"],
    ]);
    officeStaff = await userWithPermissions("office", [
      ["service_reports", "upload"],
      ["service_reports", "read"],
      ["service_reports", "verify"],
    ]);
    // A second verify-capable actor with a DIFFERENT permission set, to
    // confirm verify authorization really is role-based and not tied to
    // any one specific user.
    managerNoVerify = await userWithPermissions("manager-no-verify", [
      ["service_reports", "upload"],
      ["service_reports", "read"],
    ]);
  });

  afterAll(async () => {
    await fixtures.cleanupAll();
    await app.close();
  });

  async function createCustomerSite(suffix: string) {
    const customer = await fixtures.createCustomer(`sr-verify-${suffix}`);
    const site = await fixtures.createSite(customer.id, `sr-verify-${suffix}`);
    return { customer, site };
  }

  /**
   * Directly seeds a PENDING_VERIFICATION Service Report with a real
   * storage object and the given staging rows — bypassing the extraction
   * pipeline entirely, since this file tests the verification workflow's
   * own correctness, not extraction.
   */
  async function createPendingVerificationReport(
    suffix: string,
    uploadedBy: string,
    measurementRows: Array<{
      fieldName: string;
      aiValue: string | null;
      aiConfidence: "HIGH" | "MEDIUM" | "LOW" | "UNREADABLE" | null;
      requiresHumanVerification?: boolean;
      reviewStatus?: "CONFIRMED" | "CORRECTED" | "CONFIRMED_BLANK" | "NEEDS_FOLLOW_UP" | null;
    }> = [],
  ) {
    const { customer, site } = await createCustomerSite(suffix);
    const fileKey = `${E2E_PREFIX}/service-reports/${suffix}-${Date.now()}.jpg`;
    await storage.putObject({ key: fileKey, body: Buffer.from("fake report photo"), contentType: "image/jpeg" });

    const report = await prisma.serviceReport.create({
      data: {
        serviceReportNumber: `E2EVER-${suffix.slice(0, 8)}-${Date.now().toString(36)}`,
        customerId: customer.id,
        siteId: site.id,
        reportTypeCode: "MAINTENANCE_CLEANING",
        sourceType: "INTERNAL_SERVICE",
        status: "PENDING_VERIFICATION",
        documentFileKey: fileKey,
        documentMimeType: "image/jpeg",
        documentFileName: "report.jpg",
        documentFileSize: 17,
        uploadedBy,
        uploadedAt: new Date(),
      },
    });

    for (let i = 0; i < measurementRows.length; i++) {
      const r = measurementRows[i];
      await prisma.extractionMeasurement.create({
        data: {
          serviceReportId: report.id,
          rowIndex: i,
          fieldName: r.fieldName,
          aiValue: r.aiValue,
          aiConfidence: r.aiConfidence,
          requiresHumanVerification: r.requiresHumanVerification ?? false,
          reviewStatus: r.reviewStatus ?? null,
        },
      });
    }

    return { report, customer, site, fileKey };
  }

  describe("RBAC — role-based, not uploader-based", () => {
    it("rejects a Technician (no verify permission) from viewing verification data, even for their own upload", async () => {
      const { report } = await createPendingVerificationReport("tech-own", technician.user.id, [
        { fieldName: "low_side_pressure", aiValue: "65", aiConfidence: "HIGH" },
      ]);

      const res = await request(app.getHttpServer())
        .get(`/service-reports/${report.id}/verification`)
        .set("Authorization", technician.authHeader);

      expect(res.status).toBe(403);
    });

    it("allows an Office Staff verifier to view and act on a report even though a Technician uploaded it", async () => {
      const { report } = await createPendingVerificationReport("tech-other", technician.user.id, [
        { fieldName: "low_side_pressure", aiValue: "65", aiConfidence: "HIGH" },
      ]);

      const res = await request(app.getHttpServer())
        .get(`/service-reports/${report.id}/verification`)
        .set("Authorization", officeStaff.authHeader);

      expect(res.status).toBe(200);
      expect(res.body.fields.measurement).toHaveLength(1);
    });

    it("allows an Office Staff verifier to verify a report they themselves uploaded — no self-uploader block", async () => {
      const { report } = await createPendingVerificationReport("office-self", officeStaff.user.id, [
        { fieldName: "low_side_pressure", aiValue: "65", aiConfidence: "HIGH" },
      ]);
      const fieldId = (
        await request(app.getHttpServer()).get(`/service-reports/${report.id}/verification`).set("Authorization", officeStaff.authHeader)
      ).body.fields.measurement[0].id;

      const res = await request(app.getHttpServer())
        .patch(`/service-reports/${report.id}/verification/measurement/${fieldId}`)
        .set("Authorization", officeStaff.authHeader)
        .send({ reviewStatus: "CONFIRMED" });

      expect(res.status).toBe(200);
      expect(res.body.verifiedBy).toBe(officeStaff.user.id);
    });

    it("rejects a user with read access but no verify permission", async () => {
      const { report } = await createPendingVerificationReport("no-verify-perm", technician.user.id, []);
      const res = await request(app.getHttpServer())
        .get(`/service-reports/${report.id}/verification`)
        .set("Authorization", managerNoVerify.authHeader);
      expect(res.status).toBe(403);
    });
  });

  describe("Verification queue list (GET /service-reports)", () => {
    it("limits a Technician's verification queue to their own reports", async () => {
      const { report } = await createPendingVerificationReport("queue-other-uploader", officeStaff.user.id, []);
      const res = await request(app.getHttpServer()).get("/service-reports").set("Authorization", technician.authHeader);
      expect(res.status).toBe(200);
      expect(res.body.map((r: { id: string }) => r.id)).not.toContain(report.id);
    });

    it("lists PENDING_VERIFICATION reports by default for a user with service_reports.read", async () => {
      const { report } = await createPendingVerificationReport("queue", technician.user.id, []);
      const res = await request(app.getHttpServer()).get("/service-reports").set("Authorization", officeStaff.authHeader);
      expect(res.status).toBe(200);
      expect(res.body.map((r: { id: string }) => r.id)).toContain(report.id);
      expect(res.body.every((r: { status: string }) => r.status === "PENDING_VERIFICATION")).toBe(true);
    });
  });

  describe("Individual field verification", () => {
    it("CONFIRMED copies aiValue, is persisted, and is audit-logged", async () => {
      const { report } = await createPendingVerificationReport("confirm", technician.user.id, [
        { fieldName: "low_side_pressure", aiValue: "65", aiConfidence: "HIGH" },
      ]);
      const view = await request(app.getHttpServer()).get(`/service-reports/${report.id}/verification`).set("Authorization", officeStaff.authHeader);
      const fieldId = view.body.fields.measurement[0].id;

      const res = await request(app.getHttpServer())
        .patch(`/service-reports/${report.id}/verification/measurement/${fieldId}`)
        .set("Authorization", officeStaff.authHeader)
        .send({ reviewStatus: "CONFIRMED" });

      expect(res.status).toBe(200);
      expect(res.body.verifiedValue).toBe("65");

      const persisted = await prisma.extractionMeasurement.findUnique({ where: { id: fieldId } });
      expect(persisted!.reviewStatus).toBe("CONFIRMED");
      expect(persisted!.verifiedValue).toBe("65");
      expect(persisted!.verifiedBy).toBe(officeStaff.user.id);
      expect(persisted!.verifiedAt).not.toBeNull();
      // immutability — original AI fields untouched
      expect(persisted!.aiValue).toBe("65");
      expect(persisted!.aiConfidence).toBe("HIGH");

      const audit = await prisma.auditLog.findFirst({
        where: { action: "service_report_verification_field_reviewed", entityId: report.id },
        orderBy: { createdAt: "desc" },
      });
      expect(audit).not.toBeNull();
      expect(audit!.actorUserId).toBe(officeStaff.user.id);
    });

    it("CORRECTED without a verifiedValue is rejected with 400", async () => {
      const { report } = await createPendingVerificationReport("corrected-missing", technician.user.id, [
        { fieldName: "high_side_pressure", aiValue: "410", aiConfidence: "HIGH" },
      ]);
      const view = await request(app.getHttpServer()).get(`/service-reports/${report.id}/verification`).set("Authorization", officeStaff.authHeader);
      const fieldId = view.body.fields.measurement[0].id;

      const res = await request(app.getHttpServer())
        .patch(`/service-reports/${report.id}/verification/measurement/${fieldId}`)
        .set("Authorization", officeStaff.authHeader)
        .send({ reviewStatus: "CORRECTED" });

      expect(res.status).toBe(400);
    });

    it("CORRECTED stores the reviewer's value and leaves aiValue immutable", async () => {
      const { report } = await createPendingVerificationReport("corrected", technician.user.id, [
        { fieldName: "high_side_pressure", aiValue: "410", aiConfidence: "HIGH" },
      ]);
      const view = await request(app.getHttpServer()).get(`/service-reports/${report.id}/verification`).set("Authorization", officeStaff.authHeader);
      const fieldId = view.body.fields.measurement[0].id;

      const res = await request(app.getHttpServer())
        .patch(`/service-reports/${report.id}/verification/measurement/${fieldId}`)
        .set("Authorization", officeStaff.authHeader)
        .send({ reviewStatus: "CORRECTED", verifiedValue: "415" });

      expect(res.status).toBe(200);
      expect(res.body.verifiedValue).toBe("415");
      const persisted = await prisma.extractionMeasurement.findUnique({ where: { id: fieldId } });
      expect(persisted!.aiValue).toBe("410"); // immutable original
      expect(persisted!.verifiedValue).toBe("415");
    });

    it("CONFIRMED_BLANK is distinct from an unreviewed blank field", async () => {
      const { report } = await createPendingVerificationReport("blank", technician.user.id, [
        { fieldName: "unused_reading", aiValue: null, aiConfidence: null },
      ]);
      const view = await request(app.getHttpServer()).get(`/service-reports/${report.id}/verification`).set("Authorization", officeStaff.authHeader);
      const fieldId = view.body.fields.measurement[0].id;
      expect(view.body.fields.measurement[0].reviewStatus).toBeNull(); // unreviewed

      const res = await request(app.getHttpServer())
        .patch(`/service-reports/${report.id}/verification/measurement/${fieldId}`)
        .set("Authorization", officeStaff.authHeader)
        .send({ reviewStatus: "CONFIRMED_BLANK" });

      expect(res.status).toBe(200);
      expect(res.body.reviewStatus).toBe("CONFIRMED_BLANK");
      expect(res.body.verifiedValue).toBeNull();
    });
  });

  describe("Bulk confirmation", () => {
    it("preview and apply only touch HIGH/MEDIUM-confidence eligible fields, never LOW/flagged/unreadable/blank/already-reviewed ones", async () => {
      const { report } = await createPendingVerificationReport("bulk", technician.user.id, [
        { fieldName: "eligible_1", aiValue: "220", aiConfidence: "HIGH" },
        { fieldName: "eligible_2", aiValue: "30", aiConfidence: "MEDIUM" },
        { fieldName: "low_confidence", aiValue: "17", aiConfidence: "LOW" },
        { fieldName: "flagged", aiValue: "410", aiConfidence: "HIGH", requiresHumanVerification: true },
        { fieldName: "unreadable", aiValue: "??", aiConfidence: "UNREADABLE" },
        { fieldName: "blank", aiValue: null, aiConfidence: null },
      ]);

      const preview = await request(app.getHttpServer())
        .get(`/service-reports/${report.id}/verification/bulk-confirm/preview`)
        .set("Authorization", officeStaff.authHeader);
      expect(preview.status).toBe(200);
      expect(preview.body.eligibleCount).toBe(2);
      expect(preview.body.eligibleFields.map((f: { fieldName: string }) => f.fieldName).sort()).toEqual(["eligible_1", "eligible_2"]);

      const apply = await request(app.getHttpServer())
        .post(`/service-reports/${report.id}/verification/bulk-confirm`)
        .set("Authorization", officeStaff.authHeader);
      expect(apply.status).toBe(201);
      expect(apply.body.confirmedCount).toBe(2);

      const rows = await prisma.extractionMeasurement.findMany({ where: { serviceReportId: report.id } });
      const byName = Object.fromEntries(rows.map((r) => [r.fieldName, r]));
      expect(byName.eligible_1.reviewStatus).toBe("CONFIRMED");
      expect(byName.eligible_2.reviewStatus).toBe("CONFIRMED");
      expect(byName.low_confidence.reviewStatus).toBeNull();
      expect(byName.flagged.reviewStatus).toBeNull();
      expect(byName.unreadable.reviewStatus).toBeNull();
      expect(byName.blank.reviewStatus).toBeNull();

      const audit = await prisma.auditLog.findFirst({
        where: { action: "service_report_verification_bulk_confirmed", entityId: report.id },
        orderBy: { createdAt: "desc" },
      });
      expect(audit).not.toBeNull();
    });
  });

  describe("Completeness and NEEDS_FOLLOW_UP blocking", () => {
    it("rejects completion while a field remains unreviewed", async () => {
      const { report } = await createPendingVerificationReport("incomplete", technician.user.id, [
        { fieldName: "low_side_pressure", aiValue: "65", aiConfidence: "HIGH" },
      ]);
      const res = await request(app.getHttpServer())
        .post(`/service-reports/${report.id}/verification/complete`)
        .set("Authorization", officeStaff.authHeader);
      expect(res.status).toBe(400);
    });

    it("rejects completion while any field is NEEDS_FOLLOW_UP, and does not introduce an alternate status", async () => {
      const { report } = await createPendingVerificationReport("needs-follow-up", technician.user.id, [
        { fieldName: "a", aiValue: "1", aiConfidence: "HIGH", reviewStatus: "CONFIRMED" },
        { fieldName: "b", aiValue: "??", aiConfidence: "LOW", reviewStatus: "NEEDS_FOLLOW_UP" },
      ]);

      const res = await request(app.getHttpServer())
        .post(`/service-reports/${report.id}/verification/complete`)
        .set("Authorization", officeStaff.authHeader);
      expect(res.status).toBe(400);

      const stillPending = await prisma.serviceReport.findUnique({ where: { id: report.id } });
      expect(stillPending!.status).toBe("PENDING_VERIFICATION"); // not VERIFIED, not some exception status
    });

    it("transitions to VERIFIED once every field is CONFIRMED/CORRECTED/CONFIRMED_BLANK, recording uploadedBy/uploadedAt and verifiedBy/verifiedAt separately", async () => {
      const { report } = await createPendingVerificationReport("complete", technician.user.id, [
        { fieldName: "a", aiValue: "1", aiConfidence: "HIGH", reviewStatus: "CONFIRMED" },
        { fieldName: "b", aiValue: "2", aiConfidence: "HIGH", reviewStatus: "CORRECTED" },
        { fieldName: "c", aiValue: null, aiConfidence: null, reviewStatus: "CONFIRMED_BLANK" },
      ]);

      const res = await request(app.getHttpServer())
        .post(`/service-reports/${report.id}/verification/complete`)
        .set("Authorization", officeStaff.authHeader);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("VERIFIED");

      const updated = await prisma.serviceReport.findUnique({ where: { id: report.id } });
      expect(updated!.status).toBe("VERIFIED");
      expect(updated!.uploadedBy).toBe(technician.user.id);
      expect(updated!.verifiedBy).toBe(officeStaff.user.id);
      expect(updated!.uploadedAt).not.toBeNull();
      expect(updated!.verifiedAt).not.toBeNull();
      expect(updated!.uploadedBy).not.toBe(updated!.verifiedBy);

      const audit = await prisma.auditLog.findFirst({
        where: { action: "service_report_verified", entityId: report.id },
        orderBy: { createdAt: "desc" },
      });
      expect(audit).not.toBeNull();
    });

    it("allows verification to complete on a report with no measurement rows at all (blank technical-data report)", async () => {
      const { report } = await createPendingVerificationReport("no-rows", technician.user.id, []);
      const res = await request(app.getHttpServer())
        .post(`/service-reports/${report.id}/verification/complete`)
        .set("Authorization", officeStaff.authHeader);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("VERIFIED");
    });

    // Phase 7 Wave 1 (F3.1) — completeVerification() was hardened from a
    // plain check-then-act update to the same guarded-updateMany pattern
    // already used throughout this codebase (e.g.
    // WorkOrdersService.startOwn), specifically to close this race. Same
    // style/shape as quotation-lifecycle.e2e-spec.ts's own
    // "only one of two concurrent ... requests ... succeeds" tests.
    it("only one of two concurrent completion requests on the same PENDING_VERIFICATION report succeeds — the other gets 409", async () => {
      const { report } = await createPendingVerificationReport("concurrent-complete", technician.user.id, [
        { fieldName: "a", aiValue: "1", aiConfidence: "HIGH", reviewStatus: "CONFIRMED" },
      ]);

      const [a, b] = await Promise.all([
        request(app.getHttpServer()).post(`/service-reports/${report.id}/verification/complete`).set("Authorization", officeStaff.authHeader),
        request(app.getHttpServer()).post(`/service-reports/${report.id}/verification/complete`).set("Authorization", officeStaff.authHeader),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);

      // Exactly one real transition happened — not two, not zero.
      const finalReport = await prisma.serviceReport.findUnique({ where: { id: report.id } });
      expect(finalReport!.status).toBe("VERIFIED");

      const verifiedAudits = await prisma.auditLog.findMany({ where: { action: "service_report_verified", entityId: report.id } });
      expect(verifiedAudits).toHaveLength(1);
    });
  });
});
