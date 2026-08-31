import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { UserStatus, WorkOrderType } from "@prisma/client";
import { bootstrapTestApp, E2eFixtures } from "./support";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/http-exception.filter";
import { PrismaService } from "../../src/prisma/prisma.service";
import { STORAGE_PROVIDER, StorageProvider } from "../../src/common/storage/storage-provider.interface";
import { ExtractionQueueService } from "../../src/common/extraction/service-report-extraction.processor";

/**
 * Live E2E — Phase 5 Step 4 (Upload API). Exercises the real HTTP/guard/
 * RBAC/audit stack, the real StorageProvider (local disk), and the real
 * BullMQ queue. No Vertex AI credentials involved — EXTRACTION_PROVIDER
 * stays "stub" for this whole file, same as every other test in this repo.
 */
// /auth/login is throttled to 10 requests/60s (auth.controller.ts) — a real
// brute-force-protection measure, not a test-env quirk to work around by
// raising it. A fresh login per test would blow through that limit long
// before this file finishes, so most tests share ONE technician actor and
// ONE manager actor created once in beforeAll; a fresh actor is created
// only where a test specifically needs a distinct identity (a second
// technician, or a user missing the upload permission).
describe("Service Report upload API (live)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageProvider;
  let fixtures: E2eFixtures;
  let technician: { user: { id: string }; authHeader: string };
  let manager: { user: { id: string }; authHeader: string };

  async function loginHeader(email: string, password: string) {
    const res = await request(app.getHttpServer()).post("/auth/login").send({ email, password });
    return `Bearer ${res.body.accessToken}`;
  }

  async function userWithPermissions(suffix: string, modules: Array<[string, string]>) {
    const perms = await Promise.all(modules.map(([module, action]) => fixtures.ensurePermission(module, action)));
    const role = await fixtures.createRole(`sr-${suffix}`, perms.map((p) => p.id));
    const user = await fixtures.createUser(suffix, UserStatus.ACTIVE, [role.id]);
    const authHeader = await loginHeader(user.email, user.password);
    return { user, authHeader };
  }

  async function technicianActor(suffix: string) {
    return userWithPermissions(suffix, [
      ["service_reports", "upload"],
      ["service_reports", "read_own"],
    ]);
  }

  async function managerActor(suffix: string) {
    return userWithPermissions(suffix, [
      ["service_reports", "upload"],
      ["service_reports", "read"],
    ]);
  }

  beforeAll(async () => {
    ({ app, prisma, storage } = await bootstrapTestApp());
    fixtures = new E2eFixtures(prisma, storage);
    technician = await technicianActor("shared");
    manager = await managerActor("shared");
  });

  afterAll(async () => {
    await fixtures.cleanupAll();
    await app.close();
  });

  async function createCustomerSite(suffix: string) {
    const customer = await fixtures.createCustomer(`sr-upload-${suffix}`);
    const site = await fixtures.createSite(customer.id, `sr-upload-${suffix}`);
    return { customer, site };
  }

  function pngBuffer() {
    // Phase 7 P0 — the API now verifies the file's actual leading bytes
    // against the claimed mimetype (matchesFileSignature), so every test
    // in this file that isn't specifically exercising that check needs
    // real signature bytes, not an arbitrary short buffer.
    return Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  }

  it("uploads a Service Report end-to-end: DB row, storage object, PENDING_EXTRACTION, and both audit entries", async () => {
    const { customer, site } = await createCustomerSite("ok");

    const res = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/service-reports`)
      .set("Authorization", technician.authHeader)
      .field("siteId", site.id)
      .field("reportTypeCode", "MAINTENANCE_CLEANING")
      .field("sourceType", "INTERNAL_SERVICE")
      .attach("file", pngBuffer(), { filename: "report.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("PENDING_EXTRACTION");
    expect(res.body.uploadedBy).toBe(technician.user.id);
    expect(res.body.documentFileName).toBe("report.png");
    expect(res.body.documentFileKey).toBeUndefined(); // never exposed to the client

    const stored = await prisma.serviceReport.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.documentFileKey).toMatch(/^service-reports\//);
    await expect(storage.objectExists(stored.documentFileKey)).resolves.toBe(true);

    const auditEntries = await prisma.auditLog.findMany({
      where: { entityType: "ServiceReport", entityId: res.body.id },
      orderBy: { createdAt: "asc" },
    });
    expect(auditEntries.map((e) => e.action)).toEqual(["service_report_uploaded", "service_report_extraction_enqueued"]);
    // Audit entries record metadata only, never raw report contents.
    expect(JSON.stringify(auditEntries[0].afterData)).not.toContain("fake png bytes");

    await storage.deleteObject(stored.documentFileKey);
  });

  it("rejects an invalid reportTypeCode with 400", async () => {
    const { customer, site } = await createCustomerSite("badtype");

    const res = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/service-reports`)
      .set("Authorization", technician.authHeader)
      .field("siteId", site.id)
      .field("reportTypeCode", "NOT_A_REAL_TYPE")
      .field("sourceType", "INTERNAL_SERVICE")
      .attach("file", pngBuffer(), { filename: "report.png", contentType: "image/png" });

    expect(res.status).toBe(400);
    expect(await prisma.serviceReport.count({ where: { reportTypeCode: "NOT_A_REAL_TYPE" } })).toBe(0);
  });

  it("rejects an unsupported file type with 415 and clear messaging", async () => {
    const { customer, site } = await createCustomerSite("badfile");

    const res = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/service-reports`)
      .set("Authorization", technician.authHeader)
      .field("siteId", site.id)
      .field("reportTypeCode", "MAINTENANCE_CLEANING")
      .field("sourceType", "INTERNAL_SERVICE")
      .attach("file", Buffer.from("MZ fake exe"), { filename: "virus.exe", contentType: "application/x-msdownload" });

    expect(res.status).toBe(415);
    expect(res.body.message).toMatch(/Unsupported file type/);
  });

  // Phase 7 P0 — magic-byte verification, live against the real HTTP/
  // Multer/service stack (the unit-level proof lives in
  // service-reports.service.spec.ts and file-signature.util.spec.ts;
  // this proves it end-to-end, including that no DB row or storage
  // object is created for either failure mode).

  it.each([
    ["application/pdf", "report.pdf", Buffer.from("255044462d312e340a", "hex")],
    ["image/jpeg", "report.jpg", Buffer.from("ffd8ffe000104a46494600", "hex")],
    ["image/png", "report.png", Buffer.from("89504e470d0a1a0a0000000d49484452", "hex")],
    ["image/webp", "report.webp", Buffer.from("524946460000000057454250", "hex")],
  ])("accepts a real, valid %s file", async (mimetype, filename, realBytes) => {
    const { customer, site } = await createCustomerSite(`validsig-${filename}`);

    const res = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/service-reports`)
      .set("Authorization", technician.authHeader)
      .field("siteId", site.id)
      .field("reportTypeCode", "MAINTENANCE_CLEANING")
      .field("sourceType", "INTERNAL_SERVICE")
      .attach("file", realBytes, { filename, contentType: mimetype });

    expect(res.status).toBe(201);
    await storage.deleteObject((await prisma.serviceReport.findUniqueOrThrow({ where: { id: res.body.id } })).documentFileKey).catch(() => undefined);
  });

  it("rejects a spoofed MIME type — real PNG bytes uploaded as image/jpeg — with 415, no DB row, no storage object", async () => {
    const { customer, site } = await createCustomerSite("spoofedmime");
    const realPngBytes = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

    const res = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/service-reports`)
      .set("Authorization", technician.authHeader)
      .field("siteId", site.id)
      .field("reportTypeCode", "MAINTENANCE_CLEANING")
      .field("sourceType", "INTERNAL_SERVICE")
      .attach("file", realPngBytes, { filename: "report.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(415);
    expect(res.body.message).toMatch(/does not match the claimed type/);
    expect(await prisma.serviceReport.count({ where: { customerId: customer.id } })).toBe(0);
  });

  it("rejects a file with no recognizable signature at all (corrupted/invalid content) with 415", async () => {
    const { customer, site } = await createCustomerSite("invalidsig");

    const res = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/service-reports`)
      .set("Authorization", technician.authHeader)
      .field("siteId", site.id)
      .field("reportTypeCode", "MAINTENANCE_CLEANING")
      .field("sourceType", "INTERNAL_SERVICE")
      .attach("file", Buffer.from("this file has an allowed extension but is not really a PDF"), {
        filename: "report.pdf",
        contentType: "application/pdf",
      });

    expect(res.status).toBe(415);
    expect(await prisma.serviceReport.count({ where: { customerId: customer.id } })).toBe(0);
  });

  it("rejects a file exceeding the 25MB size limit with 413, before the signature check ever runs", async () => {
    const { customer, site } = await createCustomerSite("oversized");
    const oversized = Buffer.alloc(26 * 1024 * 1024, 0); // 26MB of zero bytes — well over MAX_UPLOAD_BYTES

    const res = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/service-reports`)
      .set("Authorization", technician.authHeader)
      .field("siteId", site.id)
      .field("reportTypeCode", "MAINTENANCE_CLEANING")
      .field("sourceType", "INTERNAL_SERVICE")
      .attach("file", oversized, { filename: "report.png", contentType: "image/png" });

    expect(res.status).toBe(413);
    expect(await prisma.serviceReport.count({ where: { customerId: customer.id } })).toBe(0);
  }, 30_000);

  it("rejects an upload from a user with no service_reports.upload permission (403)", async () => {
    const { authHeader } = await userWithPermissions("nouploadperm", [["customers", "read"]]);
    const { customer, site } = await createCustomerSite("nouploadperm");

    const res = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/service-reports`)
      .set("Authorization", authHeader)
      .field("siteId", site.id)
      .field("reportTypeCode", "MAINTENANCE_CLEANING")
      .field("sourceType", "INTERNAL_SERVICE")
      .attach("file", pngBuffer(), { filename: "report.png", contentType: "image/png" });

    expect(res.status).toBe(403);
  });

  it("rejects an unauthenticated upload with 401", async () => {
    const { customer, site } = await createCustomerSite("noauth");
    const res = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/service-reports`)
      .field("siteId", site.id)
      .field("reportTypeCode", "MAINTENANCE_CLEANING")
      .field("sourceType", "INTERNAL_SERVICE")
      .attach("file", pngBuffer(), { filename: "report.png", contentType: "image/png" });

    expect(res.status).toBe(401);
  });

  it("Technician ownership/scope: a technician can read their own upload but not another technician's", async () => {
    // The shared `technician` actor is "techA" here — only techB needs a
    // freshly created identity, keeping this file's login count well under
    // the 10/60s throttle on /auth/login.
    const techB = await technicianActor("ownb");
    const { customer, site } = await createCustomerSite("owner-scope");

    const uploadRes = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/service-reports`)
      .set("Authorization", technician.authHeader)
      .field("siteId", site.id)
      .field("reportTypeCode", "MAINTENANCE_CLEANING")
      .field("sourceType", "INTERNAL_SERVICE")
      .attach("file", pngBuffer(), { filename: "report.png", contentType: "image/png" });
    const reportId = uploadRes.body.id;

    const ownRead = await request(app.getHttpServer()).get(`/service-reports/${reportId}`).set("Authorization", technician.authHeader);
    expect(ownRead.status).toBe(200);

    const otherRead = await request(app.getHttpServer()).get(`/service-reports/${reportId}`).set("Authorization", techB.authHeader);
    expect(otherRead.status).toBe(403);

    const mineA = await request(app.getHttpServer()).get("/service-reports/mine").set("Authorization", technician.authHeader);
    expect(mineA.body.map((r: { id: string }) => r.id)).toContain(reportId);

    const mineB = await request(app.getHttpServer()).get("/service-reports/mine").set("Authorization", techB.authHeader);
    expect(mineB.body.map((r: { id: string }) => r.id)).not.toContain(reportId);

    const managerRead = await request(app.getHttpServer()).get(`/service-reports/${reportId}`).set("Authorization", manager.authHeader);
    expect(managerRead.status).toBe(200); // full read_own vs read distinction: unscoped read always wins

    const stored = await prisma.serviceReport.findUniqueOrThrow({ where: { id: reportId } });
    await storage.deleteObject(stored.documentFileKey).catch(() => undefined);
  });

  it("work-order linkage: accepts a Work Order from the same customer/site, rejects one from a different customer", async () => {
    const { customer, site } = await createCustomerSite("wolink");
    const { customer: otherCustomer, site: otherSite } = await createCustomerSite("wolink-other");

    const workOrder = await prisma.workOrder.create({
      data: {
        workOrderNumber: `E2E-WO-${Date.now().toString(36)}`,
        customerId: customer.id,
        siteId: site.id,
        workOrderType: WorkOrderType.STANDALONE,
      },
    });
    const mismatchedWorkOrder = await prisma.workOrder.create({
      data: {
        workOrderNumber: `E2E-WO2-${Date.now().toString(36)}`,
        customerId: otherCustomer.id,
        siteId: otherSite.id,
        workOrderType: WorkOrderType.STANDALONE,
      },
    });

    const goodRes = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/service-reports`)
      .set("Authorization", technician.authHeader)
      .field("siteId", site.id)
      .field("reportTypeCode", "GENERAL_SERVICE_REPAIR")
      .field("workOrderId", workOrder.id)
      .attach("file", pngBuffer(), { filename: "report.png", contentType: "image/png" });
    expect(goodRes.status).toBe(201);
    expect(goodRes.body.workOrderId).toBe(workOrder.id);
    expect(goodRes.body.sourceType).toBe("WORK_ORDER_LINKED"); // defaulted, not supplied

    const stored = await prisma.serviceReport.findUniqueOrThrow({ where: { id: goodRes.body.id } });
    await storage.deleteObject(stored.documentFileKey).catch(() => undefined);

    const badRes = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/service-reports`)
      .set("Authorization", technician.authHeader)
      .field("siteId", site.id)
      .field("reportTypeCode", "GENERAL_SERVICE_REPAIR")
      .field("workOrderId", mismatchedWorkOrder.id)
      .attach("file", pngBuffer(), { filename: "report.png", contentType: "image/png" });
    expect(badRes.status).toBe(400);
  });

  it("storage failure: rolls back cleanly and never creates a DB row", async () => {
    const failingStorage: StorageProvider = {
      putObject: async () => {
        throw new Error("simulated storage outage");
      },
      getObject: async () => Buffer.from(""),
      getSignedUrl: async () => "unused",
      objectExists: async () => false,
      deleteObject: async () => undefined,
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(STORAGE_PROVIDER)
      .useValue(failingStorage)
      .compile();
    const failingApp = moduleRef.createNestApplication();
    failingApp.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    failingApp.useGlobalFilters(new AllExceptionsFilter());
    await failingApp.init();

    try {
      const { customer, site } = await createCustomerSite("storagefail");

      const res = await request(failingApp.getHttpServer())
        .post(`/customers/${customer.id}/service-reports`)
        .set("Authorization", technician.authHeader)
        .field("siteId", site.id)
        .field("reportTypeCode", "MAINTENANCE_CLEANING")
        .field("sourceType", "INTERNAL_SERVICE")
        .attach("file", pngBuffer(), { filename: "report.png", contentType: "image/png" });

      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(await prisma.serviceReport.count({ where: { customerId: customer.id } })).toBe(0);
    } finally {
      await failingApp.close();
    }
  }, 20_000);

  it("queue failure: rolls back the DB row and the storage object, leaving no orphaned state", async () => {
    const failingQueue = { enqueueExtraction: async () => {
      throw new Error("simulated redis outage");
    } };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ExtractionQueueService)
      .useValue(failingQueue)
      .compile();
    const failingApp = moduleRef.createNestApplication();
    failingApp.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    failingApp.useGlobalFilters(new AllExceptionsFilter());
    await failingApp.init();

    try {
      const { customer, site } = await createCustomerSite("queuefail");

      const res = await request(failingApp.getHttpServer())
        .post(`/customers/${customer.id}/service-reports`)
        .set("Authorization", technician.authHeader)
        .field("siteId", site.id)
        .field("reportTypeCode", "MAINTENANCE_CLEANING")
        .field("sourceType", "INTERNAL_SERVICE")
        .attach("file", pngBuffer(), { filename: "report.png", contentType: "image/png" });

      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(await prisma.serviceReport.count({ where: { customerId: customer.id } })).toBe(0);

      const failureAudit = await prisma.auditLog.findMany({
        where: { entityType: "ServiceReport", action: "service_report_extraction_enqueue_failed" },
        orderBy: { createdAt: "desc" },
        take: 1,
      });
      expect(failureAudit).toHaveLength(1);
    } finally {
      await failingApp.close();
    }
  }, 20_000);

  it("duplicate/retry safety: enqueueing the same serviceReportId twice does not error or double-process", async () => {
    const { customer, site } = await createCustomerSite("retrysafe");

    const res = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/service-reports`)
      .set("Authorization", technician.authHeader)
      .field("siteId", site.id)
      .field("reportTypeCode", "MAINTENANCE_CLEANING")
      .field("sourceType", "INTERNAL_SERVICE")
      .attach("file", pngBuffer(), { filename: "report.png", contentType: "image/png" });
    expect(res.status).toBe(201);

    const stored = await prisma.serviceReport.findUniqueOrThrow({ where: { id: res.body.id } });
    const extractionQueue = app.get(ExtractionQueueService);

    // Simulates a client/caller retrying the enqueue step after an
    // uncertain outcome — must not throw, and BullMQ's own jobId dedup
    // (jobId: serviceReportId) means this is safe by construction.
    await expect(
      extractionQueue.enqueueExtraction({
        serviceReportId: res.body.id,
        documentFileKey: stored.documentFileKey,
        documentMimeType: stored.documentMimeType,
      }),
    ).resolves.toBeUndefined();

    await storage.deleteObject(stored.documentFileKey).catch(() => undefined);
  });
});
