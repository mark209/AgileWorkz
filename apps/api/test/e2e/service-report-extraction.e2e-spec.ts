import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/http-exception.filter";
import { PrismaService } from "../../src/prisma/prisma.service";
import { STORAGE_PROVIDER, StorageProvider } from "../../src/common/storage/storage-provider.interface";
import {
  EXTRACTION_PROVIDER,
  ExtractionBatchResult,
  ExtractionContext,
  ExtractionDocumentInput,
  ExtractionProvider,
} from "../../src/common/extraction/extraction-provider.interface";
import { ExtractionQueueService } from "../../src/common/extraction/service-report-extraction.processor";
import { E2E_PREFIX, E2eFixtures } from "./support";

/**
 * Exercises the real queue processor end-to-end (Phase 5 Approved Baseline
 * §04a, queue processor increment): BullMQ job -> storage retrieval ->
 * ExtractionContextBuilder (live reference tables) -> provider call ->
 * field routing -> ocr_worker staging writes -> app_runtime status
 * transition -> audit log. The provider itself is swapped for a
 * deterministic fake via Nest's overrideProvider — no real Vertex AI
 * credentials or network calls anywhere in this file.
 */
class FakeExtractionProvider implements ExtractionProvider {
  constructor(private readonly result: ExtractionBatchResult) {}
  async extractDocument(_document: ExtractionDocumentInput, _context: ExtractionContext): Promise<ExtractionBatchResult> {
    return this.result;
  }
}

async function waitForStatus(
  prisma: PrismaService,
  serviceReportId: string,
  isDone: (status: string) => boolean,
  timeoutMs = 10_000,
): Promise<string> {
  const startedAt = Date.now();
  for (;;) {
    const report = await prisma.serviceReport.findUniqueOrThrow({ where: { id: serviceReportId }, select: { status: true } });
    if (isDone(report.status)) return report.status;
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ServiceReport ${serviceReportId} to leave PENDING_EXTRACTION (stuck at ${report.status})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function bootstrapWithFakeProvider(fakeProvider: ExtractionProvider) {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EXTRACTION_PROVIDER)
    .useValue(fakeProvider)
    .compile();
  const app: INestApplication = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return {
    app,
    prisma: app.get(PrismaService),
    storage: app.get<StorageProvider>(STORAGE_PROVIDER),
    queue: app.get(ExtractionQueueService),
  };
}

async function createServiceReportFixture(prisma: PrismaService, fixtures: E2eFixtures, suffix: string) {
  const customer = await fixtures.createCustomer(`extraction-${suffix}`);
  const site = await fixtures.createSite(customer.id, `extraction-${suffix}`);
  const report = await prisma.serviceReport.create({
    data: {
      // service_report_number is VARCHAR(30) — keep this compact regardless
      // of suffix length (isolation for cleanup comes from the customer
      // name prefix below, not this number).
      serviceReportNumber: `E2E-SR-${suffix.slice(0, 6)}-${Date.now().toString(36)}`,
      customerId: customer.id,
      siteId: site.id,
      reportTypeCode: "MAINTENANCE_CLEANING",
      sourceType: "INTERNAL_SERVICE",
      // This fixture writes directly via Prisma (bypassing the real Step 4
      // upload API — that flow is covered separately in
      // service-reports-upload.e2e-spec.ts). document_file_key here is a
      // placeholder only — the extraction job below is enqueued with the
      // real storage key explicitly (job data, not this column), which is
      // exactly what the processor actually reads.
      documentFileKey: "unused-placeholder",
      documentMimeType: "image/jpeg",
      documentFileName: "fixture.jpg",
      documentFileSize: 17,
      status: "PENDING_EXTRACTION",
      uploadedAt: new Date(),
    },
  });
  return { customer, site, report };
}

describe("Service Report extraction queue processor (e2e)", () => {
  let prisma: PrismaService;
  let fixtures: E2eFixtures;

  afterEach(async () => {
    if (fixtures) await fixtures.cleanupAll();
  });

  it("processes a successful extraction: staging rows written by ocr_worker, status -> PENDING_VERIFICATION, audit entry recorded", async () => {
    const fakeProvider = new FakeExtractionProvider({
      status: "extracted",
      fields: [
        { category: "basicInfo", fieldName: "customer_name", value: "Acme HVAC", unit: null, confidence: "high", suggestedMeasurementTypeCode: null },
        {
          category: "measurement",
          fieldName: "low_side_pressure",
          value: "65",
          unit: "psi",
          confidence: "high",
          suggestedMeasurementTypeCode: "LOW_SIDE_PRESSURE",
          stage: "before cleaning",
          groupKey: "unit-1",
        },
      ],
      providerMetadata: { model: "fake-model", latencyMs: 12 },
    });

    const { app, prisma: appPrisma, storage, queue } = await bootstrapWithFakeProvider(fakeProvider);
    prisma = appPrisma;
    fixtures = new E2eFixtures(prisma, storage);

    try {
      const { report } = await createServiceReportFixture(prisma, fixtures, "ok");
      const fileKey = `${E2E_PREFIX}/service-reports/${report.id}.jpg`;
      await storage.putObject({ key: fileKey, body: Buffer.from("fake image bytes"), contentType: "image/jpeg" });

      await queue.enqueueExtraction({ serviceReportId: report.id, documentFileKey: fileKey, documentMimeType: "image/jpeg" });

      const finalStatus = await waitForStatus(prisma, report.id, (s) => s !== "PENDING_EXTRACTION");
      expect(finalStatus).toBe("PENDING_VERIFICATION");

      const basicInfoRows = await prisma.extractionBasicInfo.findMany({ where: { serviceReportId: report.id } });
      expect(basicInfoRows).toHaveLength(1);
      expect(basicInfoRows[0].aiValue).toBe("Acme HVAC");
      expect(basicInfoRows[0].aiConfidence).toBe("HIGH");

      const measurementRows = await prisma.extractionMeasurement.findMany({ where: { serviceReportId: report.id } });
      expect(measurementRows).toHaveLength(1);
      expect(measurementRows[0].aiValue).toBe("65");
      expect(measurementRows[0].aiUnit).toBe("psi");
      expect(measurementRows[0].stage).toBe("before cleaning");
      expect(measurementRows[0].suggestedMeasurementTypeCode).toBe("LOW_SIDE_PRESSURE");
      expect(measurementRows[0].verifiedValue).toBeNull(); // never touched by extraction — human-only field

      const auditEntries = await prisma.auditLog.findMany({
        where: { entityType: "ServiceReport", entityId: report.id, action: "service_report_extraction_attempted" },
      });
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0].actorType).toBe("WORKER");

      await storage.deleteObject(fileKey);
    } finally {
      await app.close();
    }
  }, 20_000);

  it("marks EXTRACTION_FAILED and writes no staging rows when the provider reports failure", async () => {
    const fakeProvider = new FakeExtractionProvider({ status: "failed", fields: [], error: "document unreadable" });
    const { app, prisma: appPrisma, storage, queue } = await bootstrapWithFakeProvider(fakeProvider);
    prisma = appPrisma;
    fixtures = new E2eFixtures(prisma, storage);

    try {
      const { report } = await createServiceReportFixture(prisma, fixtures, "fail");
      const fileKey = `${E2E_PREFIX}/service-reports/${report.id}.jpg`;
      await storage.putObject({ key: fileKey, body: Buffer.from("fake image bytes"), contentType: "image/jpeg" });

      await queue.enqueueExtraction({ serviceReportId: report.id, documentFileKey: fileKey, documentMimeType: "image/jpeg" });

      const finalStatus = await waitForStatus(prisma, report.id, (s) => s !== "PENDING_EXTRACTION");
      expect(finalStatus).toBe("EXTRACTION_FAILED");

      const basicInfoRows = await prisma.extractionBasicInfo.findMany({ where: { serviceReportId: report.id } });
      expect(basicInfoRows).toHaveLength(0);

      await storage.deleteObject(fileKey);
    } finally {
      await app.close();
    }
  }, 20_000);

  it("is idempotent: a report no longer PENDING_EXTRACTION is left untouched by the processor", async () => {
    const fakeProvider = new FakeExtractionProvider({
      status: "extracted",
      fields: [{ category: "basicInfo", fieldName: "x", value: "should never be written", unit: null, confidence: "high", suggestedMeasurementTypeCode: null }],
    });
    const { app, prisma: appPrisma, storage, queue } = await bootstrapWithFakeProvider(fakeProvider);
    prisma = appPrisma;
    fixtures = new E2eFixtures(prisma, storage);

    try {
      const { report } = await createServiceReportFixture(prisma, fixtures, "idempotent");
      // Simulate the report already having moved on (e.g. a re-delivered job).
      await prisma.serviceReport.update({ where: { id: report.id }, data: { status: "PENDING_VERIFICATION" } });

      const fileKey = `${E2E_PREFIX}/service-reports/${report.id}.jpg`;
      await storage.putObject({ key: fileKey, body: Buffer.from("fake image bytes"), contentType: "image/jpeg" });
      await queue.enqueueExtraction({ serviceReportId: report.id, documentFileKey: fileKey, documentMimeType: "image/jpeg" });

      // No status to "wait" for (it's already past PENDING_EXTRACTION) — give
      // the worker a moment to have picked it up and no-opped, then assert
      // nothing was written.
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const stillStatus = await prisma.serviceReport.findUniqueOrThrow({ where: { id: report.id }, select: { status: true } });
      expect(stillStatus.status).toBe("PENDING_VERIFICATION");

      const basicInfoRows = await prisma.extractionBasicInfo.findMany({ where: { serviceReportId: report.id } });
      expect(basicInfoRows).toHaveLength(0);

      await storage.deleteObject(fileKey);
    } finally {
      await app.close();
    }
  }, 20_000);
});
