import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { ServiceReportsService } from "../src/modules/service-reports/service-reports.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { AuditService } from "../src/modules/audit/audit.service";
import { PermissionsService } from "../src/modules/identity/permissions.service";
import { NumberingService } from "../src/common/numbering/numbering.service";
import { StorageProvider } from "../src/common/storage/storage-provider.interface";
import { ExtractionQueueService } from "../src/common/extraction/service-report-extraction.processor";
import { mockOf } from "./test-utils";

const actor = { userId: "actor-1", ipAddress: "127.0.0.1", userAgent: "jest" };

function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: "file",
    originalname: "report.jpg",
    encoding: "7bit",
    mimetype: "image/jpeg",
    buffer: Buffer.from("test content"),
    size: 12,
    ...overrides,
  } as Express.Multer.File;
}

const baseDto = {
  siteId: "site-1",
  reportTypeCode: "MAINTENANCE_CLEANING",
  sourceType: "INTERNAL_SERVICE" as const,
};

interface Harness {
  service: ServiceReportsService;
  prisma: ReturnType<typeof mockOf<PrismaService>>;
  audit: ReturnType<typeof mockOf<AuditService>>;
  permissions: ReturnType<typeof mockOf<PermissionsService>>;
  storage: ReturnType<typeof mockOf<StorageProvider>>;
  extractionQueue: ReturnType<typeof mockOf<ExtractionQueueService>>;
}

function buildHarness(overrides: {
  prisma?: Record<string, unknown>;
  storage?: Record<string, unknown>;
  extractionQueue?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
} = {}): Harness {
  const prisma = mockOf<PrismaService>({
    customer: { findUnique: jest.fn().mockResolvedValue({ id: "cust-1" }) },
    site: { findUnique: jest.fn().mockResolvedValue({ id: "site-1", customerId: "cust-1" }) },
    serviceReportType: { findUnique: jest.fn().mockResolvedValue({ status: "ACTIVE" }) },
    workOrder: { findUnique: jest.fn() },
    serviceReport: { delete: jest.fn().mockResolvedValue(undefined), findUnique: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
      fn({
        serviceReport: {
          create: jest.fn().mockResolvedValue({
            id: "sr-1",
            documentFileKey: "service-reports/sr-1.jpg",
            documentMimeType: "image/jpeg",
            uploadedBy: actor.userId,
          }),
        },
      }),
    ),
    ...overrides.prisma,
  });
  const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
  const permissions = mockOf<PermissionsService>({
    getEffectivePermissions: jest.fn().mockResolvedValue([]),
    ...overrides.permissions,
  });
  const storage = mockOf<StorageProvider>({
    putObject: jest.fn().mockResolvedValue({ key: "service-reports/whatever.jpg" }),
    deleteObject: jest.fn().mockResolvedValue(undefined),
    ...overrides.storage,
  });
  const extractionQueue = mockOf<ExtractionQueueService>({
    enqueueExtraction: jest.fn().mockResolvedValue(undefined),
    ...overrides.extractionQueue,
  });
  const numbering = mockOf<NumberingService>({ generateNumber: jest.fn().mockResolvedValue("SR-2026-08-00001") });

  const service = new ServiceReportsService(prisma, numbering, audit, permissions, storage, extractionQueue);
  return { service, prisma, audit, permissions, storage, extractionQueue };
}

describe("ServiceReportsService.upload", () => {
  it("rejects an upload with no file", async () => {
    const { service, storage } = buildHarness();
    await expect(service.upload("cust-1", undefined, baseDto, actor)).rejects.toThrow(BadRequestException);
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("rejects an unsupported file type before any DB lookup or storage write", async () => {
    const { service, prisma, storage } = buildHarness();
    const file = makeFile({ mimetype: "application/zip", originalname: "archive.zip" });

    await expect(service.upload("cust-1", file, baseDto, actor)).rejects.toThrow(UnsupportedMediaTypeException);
    expect(prisma.customer.findUnique).not.toHaveBeenCalled();
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it.each([
    ["application/pdf", "report.pdf"],
    ["image/jpeg", "report.jpg"],
    ["image/png", "report.png"],
    ["image/webp", "report.webp"],
  ])("accepts the approved MIME type %s", async (mimetype, originalname) => {
    const { service, storage } = buildHarness();
    const file = makeFile({ mimetype, originalname });

    await expect(service.upload("cust-1", file, baseDto, actor)).resolves.toBeDefined();
    expect(storage.putObject).toHaveBeenCalledWith(expect.objectContaining({ contentType: mimetype }));
  });

  it("rejects when the customer doesn't exist", async () => {
    const { service, storage } = buildHarness({ prisma: { customer: { findUnique: jest.fn().mockResolvedValue(null) } } });
    await expect(service.upload("cust-missing", makeFile(), baseDto, actor)).rejects.toThrow(NotFoundException);
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("rejects when the site does not belong to the given customer", async () => {
    const { service, storage } = buildHarness({
      prisma: { site: { findUnique: jest.fn().mockResolvedValue({ id: "site-1", customerId: "some-other-customer" }) } },
    });
    await expect(service.upload("cust-1", makeFile(), baseDto, actor)).rejects.toThrow(BadRequestException);
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("rejects an invalid reportTypeCode", async () => {
    const { service } = buildHarness({ prisma: { serviceReportType: { findUnique: jest.fn().mockResolvedValue(null) } } });
    await expect(service.upload("cust-1", makeFile(), baseDto, actor)).rejects.toThrow(
      /Invalid or inactive report type/,
    );
  });

  it("rejects an inactive reportTypeCode", async () => {
    const { service } = buildHarness({
      prisma: { serviceReportType: { findUnique: jest.fn().mockResolvedValue({ status: "INACTIVE" }) } },
    });
    await expect(service.upload("cust-1", makeFile(), baseDto, actor)).rejects.toThrow(
      /Invalid or inactive report type/,
    );
  });

  it("requires sourceType when no workOrderId is provided", async () => {
    const { service } = buildHarness();
    const dtoWithoutSourceType = { siteId: baseDto.siteId, reportTypeCode: baseDto.reportTypeCode };
    await expect(service.upload("cust-1", makeFile(), dtoWithoutSourceType, actor)).rejects.toThrow(
      /sourceType is required/,
    );
  });

  it("rejects a workOrderId belonging to a different customer (work-order linkage)", async () => {
    const { service, storage } = buildHarness({
      prisma: { workOrder: { findUnique: jest.fn().mockResolvedValue({ id: "wo-1", customerId: "other-cust", siteId: "site-1" }) } },
    });
    await expect(
      service.upload("cust-1", makeFile(), { ...baseDto, workOrderId: "wo-1", sourceType: undefined }, actor),
    ).rejects.toThrow(BadRequestException);
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("rejects a workOrderId belonging to a different site", async () => {
    const { service } = buildHarness({
      prisma: { workOrder: { findUnique: jest.fn().mockResolvedValue({ id: "wo-1", customerId: "cust-1", siteId: "other-site" }) } },
    });
    await expect(
      service.upload("cust-1", makeFile(), { ...baseDto, workOrderId: "wo-1", sourceType: undefined }, actor),
    ).rejects.toThrow(BadRequestException);
  });

  it("accepts a valid workOrderId matching customer and site, without requiring sourceType", async () => {
    let capturedData: Record<string, unknown> | undefined;
    const prismaOverrides = {
      workOrder: { findUnique: jest.fn().mockResolvedValue({ id: "wo-1", customerId: "cust-1", siteId: "site-1" }) },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          serviceReport: {
            create: jest.fn((args: { data: Record<string, unknown> }) => {
              capturedData = args.data;
              return Promise.resolve({ id: "sr-1", ...args.data });
            }),
          },
        }),
      ),
    };
    const { service } = buildHarness({ prisma: prismaOverrides });

    await service.upload("cust-1", makeFile(), { ...baseDto, workOrderId: "wo-1", sourceType: undefined }, actor);

    expect(capturedData?.workOrderId).toBe("wo-1");
    expect(capturedData?.sourceType).toBe("WORK_ORDER_LINKED"); // defaulted, not required from the caller
  });

  it("writes to storage before creating the DB row, forces uploadedBy to the caller, and never accepts a client-supplied status", async () => {
    let capturedData: Record<string, unknown> | undefined;
    const prismaOverrides = {
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          serviceReport: {
            create: jest.fn((args: { data: Record<string, unknown> }) => {
              capturedData = args.data;
              return Promise.resolve({ id: "sr-1", documentFileKey: "service-reports/sr-1.jpg", ...args.data });
            }),
          },
        }),
      ),
    };
    const { service, storage } = buildHarness({ prisma: prismaOverrides });

    const result = await service.upload("cust-1", makeFile(), baseDto, actor);

    expect(storage.putObject).toHaveBeenCalled();
    expect(capturedData?.uploadedBy).toBe(actor.userId);
    expect(capturedData?.status).toBe("PENDING_EXTRACTION");
    expect((result as Record<string, unknown>).documentFileKey).toBeUndefined(); // never exposed to the client
  });

  it("enqueues the extraction job after a successful upload and audits both steps", async () => {
    const prismaOverrides = {
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          serviceReport: {
            create: jest.fn().mockResolvedValue({
              id: "sr-1",
              documentFileKey: "service-reports/sr-1.jpg",
              documentMimeType: "image/jpeg",
            }),
          },
        }),
      ),
    };
    const { service, extractionQueue, audit } = buildHarness({ prisma: prismaOverrides });

    await service.upload("cust-1", makeFile(), baseDto, actor);

    expect(extractionQueue.enqueueExtraction).toHaveBeenCalledWith({
      serviceReportId: "sr-1",
      documentFileKey: "service-reports/sr-1.jpg",
      documentMimeType: "image/jpeg",
    });
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: "service_report_uploaded", entityId: "sr-1" }));
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: "service_report_extraction_enqueued", entityId: "sr-1" }),
    );
  });

  it("rolls back the storage object if the DB write fails", async () => {
    const prismaOverrides = {
      $transaction: jest.fn().mockRejectedValue(new Error("db exploded")),
    };
    const { service, storage, extractionQueue } = buildHarness({ prisma: prismaOverrides });

    await expect(service.upload("cust-1", makeFile(), baseDto, actor)).rejects.toThrow("db exploded");
    expect(storage.deleteObject).toHaveBeenCalled();
    expect(extractionQueue.enqueueExtraction).not.toHaveBeenCalled();
  });

  it("never attempts the DB write if the storage write itself fails", async () => {
    const { service, prisma } = buildHarness({ storage: { putObject: jest.fn().mockRejectedValue(new Error("storage down")) } });
    await expect(service.upload("cust-1", makeFile(), baseDto, actor)).rejects.toThrow("storage down");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rolls back the DB row and storage object, and audits the failure, when the queue enqueue fails", async () => {
    const prismaOverrides = {
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          serviceReport: {
            create: jest.fn().mockResolvedValue({
              id: "sr-1",
              documentFileKey: "service-reports/sr-1.jpg",
              documentMimeType: "image/jpeg",
            }),
          },
        }),
      ),
      serviceReport: { delete: jest.fn().mockResolvedValue(undefined) },
    };
    const { service, prisma, storage, audit } = buildHarness({
      prisma: prismaOverrides,
      extractionQueue: { enqueueExtraction: jest.fn().mockRejectedValue(new Error("redis unreachable")) },
    });

    await expect(service.upload("cust-1", makeFile(), baseDto, actor)).rejects.toThrow(InternalServerErrorException);
    expect(prisma.serviceReport.delete).toHaveBeenCalledWith({ where: { id: "sr-1" } });
    expect(storage.deleteObject).toHaveBeenCalled();
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: "service_report_extraction_enqueue_failed", entityId: "sr-1" }),
    );
  });

  it("does not fail the whole upload if the rollback's own storage cleanup fails after a queue failure", async () => {
    const prismaOverrides = {
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          serviceReport: {
            create: jest.fn().mockResolvedValue({ id: "sr-1", documentFileKey: "service-reports/sr-1.jpg", documentMimeType: "image/jpeg" }),
          },
        }),
      ),
      serviceReport: { delete: jest.fn().mockResolvedValue(undefined) },
    };
    const { service } = buildHarness({
      prisma: prismaOverrides,
      storage: { deleteObject: jest.fn().mockRejectedValue(new Error("storage also down")) },
      extractionQueue: { enqueueExtraction: jest.fn().mockRejectedValue(new Error("redis unreachable")) },
    });

    // Still surfaces the enqueue failure as the outward error, not the
    // secondary storage-cleanup failure.
    await expect(service.upload("cust-1", makeFile(), baseDto, actor)).rejects.toThrow(InternalServerErrorException);
  });
});

describe("ServiceReportsService.getForActor — read vs. read_own (D4-style)", () => {
  const report = { id: "sr-1", uploadedBy: "uploader-1" };

  it("full read permission returns the report regardless of uploader", async () => {
    const { service } = buildHarness({
      prisma: { serviceReport: { findUnique: jest.fn().mockResolvedValue(report) } },
      permissions: { getEffectivePermissions: jest.fn().mockResolvedValue([{ module: "service_reports", action: "read" }]) },
    });
    await expect(service.getForActor("sr-1", { userId: "someone-else" })).resolves.toMatchObject({ id: "sr-1" });
  });

  it("read_own returns the report when the caller is the uploader", async () => {
    const { service } = buildHarness({
      prisma: { serviceReport: { findUnique: jest.fn().mockResolvedValue(report) } },
      permissions: { getEffectivePermissions: jest.fn().mockResolvedValue([{ module: "service_reports", action: "read_own" }]) },
    });
    await expect(service.getForActor("sr-1", { userId: "uploader-1" })).resolves.toMatchObject({ id: "sr-1" });
  });

  it("read_own rejects a caller who is not the uploader — never bypassable by knowing the id", async () => {
    const { service } = buildHarness({
      prisma: { serviceReport: { findUnique: jest.fn().mockResolvedValue(report) } },
      permissions: { getEffectivePermissions: jest.fn().mockResolvedValue([{ module: "service_reports", action: "read_own" }]) },
    });
    await expect(service.getForActor("sr-1", { userId: "someone-else" })).rejects.toThrow(ForbiddenException);
  });

  it("rejects a caller holding neither read nor read_own", async () => {
    const { service } = buildHarness({
      prisma: { serviceReport: { findUnique: jest.fn().mockResolvedValue(report) } },
      permissions: { getEffectivePermissions: jest.fn().mockResolvedValue([]) },
    });
    await expect(service.getForActor("sr-1", { userId: "uploader-1" })).rejects.toThrow(ForbiddenException);
  });

  it("throws NotFoundException for a missing report before any permission check", async () => {
    const { service, permissions } = buildHarness({
      prisma: { serviceReport: { findUnique: jest.fn().mockResolvedValue(null) } },
    });
    await expect(service.getForActor("missing", { userId: "x" })).rejects.toThrow(NotFoundException);
    expect(permissions.getEffectivePermissions).not.toHaveBeenCalled();
  });
});

describe("ServiceReportsService.listForUploader", () => {
  it("filters by uploadedBy at the query, not after a broader fetch", async () => {
    const rows = [{ id: "sr-1", uploadedBy: "u1" }];
    const { service, prisma } = buildHarness({ prisma: { serviceReport: { findMany: jest.fn().mockResolvedValue(rows) } } });

    await service.listForUploader("u1");

    expect(prisma.serviceReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { uploadedBy: "u1" } }),
    );
  });
});
