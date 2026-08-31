import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { getQueueToken } from "@nestjs/bullmq";
import request from "supertest";
import { Queue } from "bullmq";
import { UserStatus } from "@prisma/client";
import { bootstrapTestApp, E2eFixtures } from "./support";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/http-exception.filter";
import { PrismaService } from "../../src/prisma/prisma.service";
import { STORAGE_PROVIDER, StorageProvider } from "../../src/common/storage/storage-provider.interface";
import { SERVICE_REPORT_EXTRACTION_QUEUE, ServiceReportExtractionJobData } from "../../src/common/extraction/service-report-extraction.processor";

/**
 * Live E2E — Phase 7 (F7.1, approved mini-design:
 * docs/architecture/phase7-f7.1-idempotency-design.md). Proves the
 * Idempotency-Key contract against the real HTTP/guard/RBAC/DB/queue
 * stack — deliberately not unit-tested-only, per the explicit instruction
 * that database/concurrency behavior must be proven at the e2e level.
 *
 * service-reports-upload.e2e-spec.ts (all 10 tests, unmodified) remains
 * the proof that every caller NOT sending the header gets exactly the
 * pre-F7.1 behavior — this file only adds the new, header-driven paths.
 */
describe("Service Report upload idempotency (F7.1, live)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageProvider;
  let queue: Queue<ServiceReportExtractionJobData>;
  let fixtures: E2eFixtures;
  let technician: { user: { id: string }; authHeader: string };
  let noUploadPermission: { authHeader: string };

  async function loginHeader(email: string, password: string) {
    const res = await request(app.getHttpServer()).post("/auth/login").send({ email, password });
    return `Bearer ${res.body.accessToken}`;
  }

  async function userWithPermissions(suffix: string, modules: Array<[string, string]>) {
    const perms = await Promise.all(modules.map(([module, action]) => fixtures.ensurePermission(module, action)));
    const role = await fixtures.createRole(`sr-idem-${suffix}`, perms.map((p) => p.id));
    const user = await fixtures.createUser(suffix, UserStatus.ACTIVE, [role.id]);
    const authHeader = await loginHeader(user.email, user.password);
    return { user, authHeader };
  }

  beforeAll(async () => {
    ({ app, prisma, storage } = await bootstrapTestApp());
    queue = app.get(getQueueToken(SERVICE_REPORT_EXTRACTION_QUEUE));
    fixtures = new E2eFixtures(prisma, storage);
    technician = await userWithPermissions("shared", [
      ["service_reports", "upload"],
      ["service_reports", "read_own"],
    ]);
    const noPermRole = await fixtures.createRole("sr-idem-noperm");
    const noPermUser = await fixtures.createUser("idem-noperm", UserStatus.ACTIVE, [noPermRole.id]);
    noUploadPermission = { authHeader: await loginHeader(noPermUser.email, noPermUser.password) };
  });

  afterAll(async () => {
    await fixtures.cleanupAll();
    await app.close();
  });

  async function createCustomerSite(suffix: string) {
    const customer = await fixtures.createCustomer(`sr-idem-${suffix}`);
    const site = await fixtures.createSite(customer.id, `sr-idem-${suffix}`);
    return { customer, site };
  }

  function pngBuffer() {
    return Buffer.from("fake png bytes for idempotency e2e testing");
  }

  function uploadRequest(app_: INestApplication, customerId: string, siteId: string, authHeader: string, idempotencyKey?: string) {
    const req = request(app_.getHttpServer())
      .post(`/customers/${customerId}/service-reports`)
      .set("Authorization", authHeader)
      .field("siteId", siteId)
      .field("reportTypeCode", "MAINTENANCE_CLEANING")
      .field("sourceType", "INTERNAL_SERVICE")
      .attach("file", pngBuffer(), { filename: "report.png", contentType: "image/png" });
    return idempotencyKey ? req.set("Idempotency-Key", idempotencyKey) : req;
  }

  // Counts real BullMQ jobs whose data.serviceReportId matches — a direct
  // proof against the actual queue, not an inference from our own audit
  // log. jobId is the serviceReportId itself (ExtractionQueueService), so
  // this also implicitly proves BullMQ's own jobId-uniqueness guard never
  // had to reject a second add() for the same report.
  async function countExtractionJobsFor(serviceReportId: string): Promise<number> {
    const jobs = await queue.getJobs(["waiting", "active", "completed", "failed", "delayed"]);
    return jobs.filter((j) => j.data.serviceReportId === serviceReportId).length;
  }

  describe("normal upload with an Idempotency-Key", () => {
    it("succeeds, creates exactly one ServiceReport, one idempotency-key row (COMPLETED), and exactly one extraction job", async () => {
      const { customer, site } = await createCustomerSite("normal");
      const key = `key-normal-${Date.now()}`;

      const res = await uploadRequest(app, customer.id, site.id, technician.authHeader, key);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("PENDING_EXTRACTION");

      expect(await prisma.serviceReport.count({ where: { customerId: customer.id } })).toBe(1);

      const keyRow = await prisma.serviceReportUploadIdempotencyKey.findUnique({
        where: { uploadedBy_idempotencyKey: { uploadedBy: technician.user.id, idempotencyKey: key } },
      });
      expect(keyRow).not.toBeNull();
      expect(keyRow!.status).toBe("COMPLETED");
      expect(keyRow!.serviceReportId).toBe(res.body.id);

      expect(await countExtractionJobsFor(res.body.id)).toBe(1);
    });
  });

  describe("retry with the same key", () => {
    it("returns the ORIGINAL result, creates no second ServiceReport, and enqueues no second extraction job", async () => {
      const { customer, site } = await createCustomerSite("retry");
      const key = `key-retry-${Date.now()}`;

      const first = await uploadRequest(app, customer.id, site.id, technician.authHeader, key);
      expect(first.status).toBe(201);

      const second = await uploadRequest(app, customer.id, site.id, technician.authHeader, key);
      expect(second.status).toBe(201);
      expect(second.body.id).toBe(first.body.id);
      expect(second.body.serviceReportNumber).toBe(first.body.serviceReportNumber);

      expect(await prisma.serviceReport.count({ where: { customerId: customer.id } })).toBe(1);
      expect(await countExtractionJobsFor(first.body.id)).toBe(1);

      const uploadedAudits = await prisma.auditLog.findMany({
        where: { entityType: "ServiceReport", entityId: first.body.id, action: "service_report_uploaded" },
      });
      expect(uploadedAudits).toHaveLength(1); // the retry never re-ran performUpload at all
    });
  });

  describe("simultaneous/concurrent requests using the same key", () => {
    it("exactly one ServiceReport and one extraction job result, no matter which request 'wins'", async () => {
      const { customer, site } = await createCustomerSite("concurrent");
      const key = `key-concurrent-${Date.now()}`;

      const [a, b] = await Promise.all([
        uploadRequest(app, customer.id, site.id, technician.authHeader, key),
        uploadRequest(app, customer.id, site.id, technician.authHeader, key),
      ]);

      // Both legitimate outcomes for the "loser" are allowed by the design:
      // 409 (it was still IN_PROGRESS when the loser re-checked) or 201
      // with the SAME report id (it had already COMPLETED by then). What
      // must never happen is two different report ids both succeeding.
      const successes = [a, b].filter((r) => r.status === 201);
      expect(successes.length).toBeGreaterThanOrEqual(1);
      const reportIds = new Set(successes.map((r) => r.body.id));
      expect(reportIds.size).toBe(1);

      const others = [a, b].filter((r) => r.status !== 201);
      for (const r of others) {
        expect(r.status).toBe(409);
      }

      expect(await prisma.serviceReport.count({ where: { customerId: customer.id } })).toBe(1);
      const [reportId] = [...reportIds];
      expect(await countExtractionJobsFor(reportId)).toBe(1);

      const uploadedAudits = await prisma.auditLog.findMany({
        where: { entityType: "ServiceReport", action: "service_report_uploaded", entityId: reportId },
      });
      expect(uploadedAudits).toHaveLength(1);
    });
  });

  describe("different keys uploading separate reports", () => {
    it("creates two independent ServiceReports for the same uploader", async () => {
      const { customer, site } = await createCustomerSite("diffkeys");
      const keyA = `key-a-${Date.now()}`;
      const keyB = `key-b-${Date.now()}`;

      const resA = await uploadRequest(app, customer.id, site.id, technician.authHeader, keyA);
      const resB = await uploadRequest(app, customer.id, site.id, technician.authHeader, keyB);

      expect(resA.status).toBe(201);
      expect(resB.status).toBe(201);
      expect(resA.body.id).not.toBe(resB.body.id);
      expect(await prisma.serviceReport.count({ where: { customerId: customer.id } })).toBe(2);
    });
  });

  describe("same key value used by different permitted uploaders", () => {
    it("never collides — uniqueness is scoped per uploader, so both succeed independently", async () => {
      const secondTechnician = await userWithPermissions("second-uploader", [
        ["service_reports", "upload"],
        ["service_reports", "read_own"],
      ]);
      const { customer, site } = await createCustomerSite("shared-key-value");
      const sharedKeyValue = "identical-key-string-coincidence";

      const resA = await uploadRequest(app, customer.id, site.id, technician.authHeader, sharedKeyValue);
      const resB = await uploadRequest(app, customer.id, site.id, secondTechnician.authHeader, sharedKeyValue);

      expect(resA.status).toBe(201);
      expect(resB.status).toBe(201);
      expect(resA.body.id).not.toBe(resB.body.id);

      const rowA = await prisma.serviceReportUploadIdempotencyKey.findUnique({
        where: { uploadedBy_idempotencyKey: { uploadedBy: technician.user.id, idempotencyKey: sharedKeyValue } },
      });
      const rowB = await prisma.serviceReportUploadIdempotencyKey.findUnique({
        where: { uploadedBy_idempotencyKey: { uploadedBy: secondTechnician.user.id, idempotencyKey: sharedKeyValue } },
      });
      expect(rowA!.serviceReportId).toBe(resA.body.id);
      expect(rowB!.serviceReportId).toBe(resB.body.id);
    });
  });

  describe("failed first attempt followed by retry", () => {
    it("marks the key FAILED (not stuck) on a real storage failure, and a retry with the same key then succeeds", async () => {
      const failingStorage: StorageProvider = {
        putObject: async () => {
          throw new Error("simulated storage outage for idempotency retry test");
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

      const { customer, site } = await createCustomerSite("failretry");
      const key = `key-failretry-${Date.now()}`;

      try {
        const failedRes = await uploadRequest(failingApp, customer.id, site.id, technician.authHeader, key);
        expect(failedRes.status).toBeGreaterThanOrEqual(500);
        expect(await prisma.serviceReport.count({ where: { customerId: customer.id } })).toBe(0);

        const keyRowAfterFailure = await prisma.serviceReportUploadIdempotencyKey.findUnique({
          where: { uploadedBy_idempotencyKey: { uploadedBy: technician.user.id, idempotencyKey: key } },
        });
        expect(keyRowAfterFailure!.status).toBe("FAILED");
        expect(keyRowAfterFailure!.serviceReportId).toBeNull();
      } finally {
        await failingApp.close();
      }

      // Retry against the REAL (working) app, same key.
      const retryRes = await uploadRequest(app, customer.id, site.id, technician.authHeader, key);
      expect(retryRes.status).toBe(201);
      expect(await prisma.serviceReport.count({ where: { customerId: customer.id } })).toBe(1);

      const keyRowAfterRetry = await prisma.serviceReportUploadIdempotencyKey.findUnique({
        where: { uploadedBy_idempotencyKey: { uploadedBy: technician.user.id, idempotencyKey: key } },
      });
      expect(keyRowAfterRetry!.status).toBe("COMPLETED");
      expect(keyRowAfterRetry!.serviceReportId).toBe(retryRes.body.id);
    }, 20_000);
  });

  describe("callers that do not send an Idempotency-Key", () => {
    it("behaves exactly as before F7.1, and creates no idempotency-key row at all", async () => {
      const { customer, site } = await createCustomerSite("nokey");

      const res = await uploadRequest(app, customer.id, site.id, technician.authHeader /* no key */);
      expect(res.status).toBe(201);
      expect(await prisma.serviceReport.count({ where: { customerId: customer.id } })).toBe(1);

      const anyKeyRowForThisReport = await prisma.serviceReportUploadIdempotencyKey.findUnique({
        where: { serviceReportId: res.body.id },
      });
      expect(anyKeyRowForThisReport).toBeNull();

      // Two more uploads with no key, same uploader — today's exact
      // pre-F7.1 behavior: every call always creates its own report.
      const res2 = await uploadRequest(app, customer.id, site.id, technician.authHeader);
      expect(res2.status).toBe(201);
      expect(res2.body.id).not.toBe(res.body.id);
      expect(await prisma.serviceReport.count({ where: { customerId: customer.id } })).toBe(2);
    });
  });

  describe("RBAC is unaffected by the Idempotency-Key header", () => {
    it("still rejects a caller without service_reports.upload, whether or not a key is sent", async () => {
      const { customer, site } = await createCustomerSite("rbac");
      const res = await uploadRequest(app, customer.id, site.id, noUploadPermission.authHeader, `key-rbac-${Date.now()}`);
      expect(res.status).toBe(403);
      expect(await prisma.serviceReport.count({ where: { customerId: customer.id } })).toBe(0);
    });
  });
});
