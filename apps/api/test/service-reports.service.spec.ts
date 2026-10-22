import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ServiceReportsService } from "../src/modules/service-reports/service-reports.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { AuditService } from "../src/modules/audit/audit.service";
import { PermissionsService } from "../src/modules/identity/permissions.service";
import { ServiceAccessService } from "../src/modules/identity/service-access.service";
import { NumberingService } from "../src/common/numbering/numbering.service";
import { StorageProvider } from "../src/common/storage/storage-provider.interface";
import { ExtractionQueueService } from "../src/common/extraction/service-report-extraction.processor";
import { mockOf } from "./test-utils";

const actor = { userId: "actor-1", ipAddress: "127.0.0.1", userAgent: "jest" };

// Phase 7 P0 — real leading bytes per allowed type, since upload() now
// verifies file content against the claimed mimetype (matchesFileSignature),
// not just the header. Keyed by mimetype so makeFile({ mimetype: "..." })
// automatically gets a buffer that actually passes the new check, without
// every existing call site needing to also specify a buffer — only tests
// that deliberately exercise a mismatch pass their own `buffer` override.
const VALID_SIGNATURE_BYTES: Record<string, Buffer> = {
  "application/pdf": Buffer.from("255044462d312e340a", "hex"), // "%PDF-1.4\n"
  "image/jpeg": Buffer.from("ffd8ffe000104a46494600", "hex"),
  "image/png": Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"),
  "image/webp": Buffer.from("524946460000000057454250", "hex"), // "RIFF"+size+"WEBP"
};

function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  const mimetype = overrides.mimetype ?? "image/jpeg";
  const defaultBuffer = VALID_SIGNATURE_BYTES[mimetype] ?? Buffer.from("test content");
  return {
    fieldname: "file",
    originalname: "report.jpg",
    encoding: "7bit",
    mimetype,
    buffer: defaultBuffer,
    size: defaultBuffer.length,
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

  const access = new ServiceAccessService(prisma, permissions);
  const service = new ServiceReportsService(prisma, numbering, audit, permissions, access, storage, extractionQueue);
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

  // Phase 7 P0 — magic-byte verification. The MIME-allowlist check above
  // only ever trusted the client-supplied Content-Type header; these prove
  // the file's actual bytes are also checked, before any DB lookup or
  // storage write (same fail-fast placement as every other upload guard).
  it("rejects a spoofed MIME type — real PNG bytes claiming to be a JPEG — with 415, before any DB lookup or storage write", async () => {
    const { service, prisma, storage } = buildHarness();
    const file = makeFile({ mimetype: "image/jpeg", buffer: Buffer.from("89504e470d0a1a0a0000000d49484452", "hex") });

    await expect(service.upload("cust-1", file, baseDto, actor)).rejects.toThrow(UnsupportedMediaTypeException);
    expect(prisma.customer.findUnique).not.toHaveBeenCalled();
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("rejects a file whose bytes match no real signature at all (invalid/corrupted content)", async () => {
    const { service, storage } = buildHarness();
    const file = makeFile({ mimetype: "application/pdf", buffer: Buffer.from("this is plain text, not a PDF") });

    await expect(service.upload("cust-1", file, baseDto, actor)).rejects.toThrow(UnsupportedMediaTypeException);
    expect(storage.putObject).not.toHaveBeenCalled();
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

  it("rejects WORK_ORDER_LINKED without a Work Order before writing a file", async () => {
    const { service, storage } = buildHarness();
    await expect(service.upload("cust-1", makeFile(), { ...baseDto, sourceType: "WORK_ORDER_LINKED" }, actor))
      .rejects.toThrow(/requires a workOrderId/);
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("rejects a direct source type when a Work Order is linked", async () => {
    const { service, storage } = buildHarness({
      prisma: { workOrder: { findUnique: jest.fn().mockResolvedValue({ id: "wo-1", customerId: "cust-1", siteId: "site-1" }) } },
    });
    await expect(service.upload("cust-1", makeFile(), { ...baseDto, workOrderId: "wo-1" }, actor))
      .rejects.toThrow(/must use WORK_ORDER_LINKED/);
    expect(storage.putObject).not.toHaveBeenCalled();
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

  it("rejects a Technician upload linked to a Work Order without a current assignment", async () => {
    const { service, storage, prisma } = buildHarness({
      prisma: {
        workOrder: { findUnique: jest.fn().mockResolvedValue({ id: "wo-1", customerId: "cust-1", siteId: "site-1" }) },
        workOrderAssignment: { findFirst: jest.fn().mockResolvedValue(null) },
      },
      permissions: { getEffectivePermissions: jest.fn().mockResolvedValue([{ module: "work_orders", action: "start_own" }]) },
    });
    await expect(service.upload("cust-1", makeFile(), { ...baseDto, workOrderId: "wo-1", sourceType: undefined }, actor))
      .rejects.toThrow(ForbiddenException);
    expect(prisma.workOrderAssignment.findFirst).toHaveBeenCalledWith({
      where: { workOrderId: "wo-1", technicianId: actor.userId, unassignedAt: null }, select: { id: true },
    });
    expect(storage.putObject).not.toHaveBeenCalled();
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
    expect(capturedData?.status).toBe("PENDING_VERIFICATION");
    expect(capturedData?.verificationBasis).toBe("DOCUMENT_ONLY");
    expect((result as Record<string, unknown>).documentFileKey).toBeUndefined(); // never exposed to the client
  });

  it("requests document review without enqueuing extraction", async () => {
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

    expect(extractionQueue.enqueueExtraction).not.toHaveBeenCalled();
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: "service_report_uploaded", entityId: "sr-1" }));
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: "service_report_document_review_requested", entityId: "sr-1" }),
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

  it("does not depend on Redis queue availability for document-only upload", async () => {
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
    const { service, prisma, storage, audit, extractionQueue } = buildHarness({
      prisma: prismaOverrides,
      extractionQueue: { enqueueExtraction: jest.fn().mockRejectedValue(new Error("redis unreachable")) },
    });

    await expect(service.upload("cust-1", makeFile(), baseDto, actor)).resolves.toBeDefined();
    expect(extractionQueue.enqueueExtraction).not.toHaveBeenCalled();
    expect(prisma.serviceReport.delete).not.toHaveBeenCalled();
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: "service_report_document_review_requested", entityId: "sr-1" }),
    );
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

// Phase 7 (F7.1) — claimIdempotencyKey()'s branching logic, isolated from
// real DB/HTTP/concurrency timing (that proof lives in
// service-reports-upload-idempotency.e2e-spec.ts, per the explicit
// instruction that database/concurrency behavior must be proven at the
// e2e level, not merely asserted here). These tests cover branches that
// are impractical or impossible to trigger against a real DB (a
// structurally-impossible COMPLETED-with-no-report row; forcing a P2002
// on the very first insert).
describe("ServiceReportsService.upload — Idempotency-Key validation", () => {
  it("rejects a key longer than 100 characters with a clean BadRequestException, no DB round-trip", async () => {
    const idemKey = { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() };
    const { service, storage } = buildHarness({ prisma: { serviceReportUploadIdempotencyKey: idemKey } });

    await expect(service.upload("cust-1", makeFile(), baseDto, actor, "x".repeat(101))).rejects.toThrow(BadRequestException);
    expect(idemKey.findUnique).not.toHaveBeenCalled();
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("accepts a key at exactly the 100-character boundary", async () => {
    const idemKey = {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "claim-1" }),
      update: jest.fn().mockResolvedValue(undefined),
      updateMany: jest.fn(),
    };
    const { service } = buildHarness({ prisma: { serviceReportUploadIdempotencyKey: idemKey } });

    await expect(service.upload("cust-1", makeFile(), baseDto, actor, "x".repeat(100))).resolves.toBeDefined();
  });

  it("treats an empty-string key the same as no key at all (today's exact pre-F7.1 behavior), not a validation error", async () => {
    // An empty string is falsy in JS, so `upload()`'s own `if (!idempotencyKey)`
    // check takes the early-return path before ever reaching this
    // length/character validation — documenting that explicitly rather
    // than leaving it ambiguous which check "wins".
    const { service } = buildHarness();
    await expect(service.upload("cust-1", makeFile(), baseDto, actor, "")).resolves.toBeDefined();
  });

  it.each(["has spaces", "has/slash", "has,comma", "has\nnewline", "has\ttab"])(
    "rejects a key containing disallowed characters: %j",
    async (key) => {
      const { service } = buildHarness();
      await expect(service.upload("cust-1", makeFile(), baseDto, actor, key)).rejects.toThrow(BadRequestException);
    },
  );

  it("accepts a realistic UUID-shaped key", async () => {
    const idemKey = {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "claim-1" }),
      update: jest.fn().mockResolvedValue(undefined),
      updateMany: jest.fn(),
    };
    const { service } = buildHarness({ prisma: { serviceReportUploadIdempotencyKey: idemKey } });

    await expect(
      service.upload("cust-1", makeFile(), baseDto, actor, "a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7"),
    ).resolves.toBeDefined();
  });
});

describe("ServiceReportsService.upload — Idempotency-Key branches", () => {
  it("never touches serviceReportUploadIdempotencyKey when no key is supplied", async () => {
    const idemKey = { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() };
    const { service } = buildHarness({ prisma: { serviceReportUploadIdempotencyKey: idemKey } });

    await service.upload("cust-1", makeFile(), baseDto, actor);

    expect(idemKey.findUnique).not.toHaveBeenCalled();
    expect(idemKey.create).not.toHaveBeenCalled();
  });

  it("a brand-new key: creates an IN_PROGRESS claim, proceeds, then marks it COMPLETED with the new report id", async () => {
    const idemKey = {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "claim-1" }),
      update: jest.fn().mockResolvedValue(undefined),
      updateMany: jest.fn(),
    };
    const { service } = buildHarness({ prisma: { serviceReportUploadIdempotencyKey: idemKey } });

    const result = await service.upload("cust-1", makeFile(), baseDto, actor, "fresh-key");

    expect(idemKey.create).toHaveBeenCalledWith({ data: { uploadedBy: actor.userId, idempotencyKey: "fresh-key", status: "IN_PROGRESS" } });
    expect(idemKey.update).toHaveBeenCalledWith({ where: { id: "claim-1" }, data: { status: "COMPLETED", serviceReportId: result.id } });
  });

  it("an existing COMPLETED key short-circuits: no storage write, no new report, no enqueue", async () => {
    const idemKey = {
      findUnique: jest.fn().mockResolvedValue({ id: "claim-1", status: "COMPLETED", serviceReportId: "sr-existing" }),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    };
    const existingReport = { id: "sr-existing", documentFileKey: "k", documentMimeType: "image/jpeg", uploadedBy: actor.userId };
    const { service, storage, extractionQueue } = buildHarness({
      prisma: { serviceReportUploadIdempotencyKey: idemKey, serviceReport: { findUnique: jest.fn().mockResolvedValue(existingReport) } },
    });

    const result = await service.upload("cust-1", makeFile(), baseDto, actor, "already-done-key");

    expect(result.id).toBe("sr-existing");
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(extractionQueue.enqueueExtraction).not.toHaveBeenCalled();
    expect(idemKey.create).not.toHaveBeenCalled();
  });

  it("a COMPLETED key with no linked report is a data-inconsistency error, not a silent guess", async () => {
    const idemKey = {
      findUnique: jest.fn().mockResolvedValue({ id: "claim-1", status: "COMPLETED", serviceReportId: null }),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    };
    const { service } = buildHarness({ prisma: { serviceReportUploadIdempotencyKey: idemKey } });

    await expect(service.upload("cust-1", makeFile(), baseDto, actor, "broken-key")).rejects.toThrow(InternalServerErrorException);
  });

  it("an existing IN_PROGRESS key is a genuine concurrent conflict — 409, no work done", async () => {
    const idemKey = {
      findUnique: jest.fn().mockResolvedValue({ id: "claim-1", status: "IN_PROGRESS", serviceReportId: null }),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    };
    const { service, storage } = buildHarness({ prisma: { serviceReportUploadIdempotencyKey: idemKey } });

    await expect(service.upload("cust-1", makeFile(), baseDto, actor, "in-flight-key")).rejects.toThrow(ConflictException);
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("an existing FAILED key is atomically re-claimed and the upload retried", async () => {
    const idemKey = {
      findUnique: jest.fn().mockResolvedValue({ id: "claim-1", status: "FAILED", serviceReportId: null }),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const { service, storage } = buildHarness({ prisma: { serviceReportUploadIdempotencyKey: idemKey } });

    const result = await service.upload("cust-1", makeFile(), baseDto, actor, "retry-key");

    expect(idemKey.updateMany).toHaveBeenCalledWith({ where: { id: "claim-1", status: "FAILED" }, data: { status: "IN_PROGRESS" } });
    expect(storage.putObject).toHaveBeenCalled();
    expect(idemKey.update).toHaveBeenCalledWith({ where: { id: "claim-1" }, data: { status: "COMPLETED", serviceReportId: result.id } });
  });

  it("loses the re-claim race on a FAILED row (updateMany count 0), re-reads, and resolves against the fresh state", async () => {
    const idemKey = {
      findUnique: jest
        .fn()
        .mockResolvedValueOnce({ id: "claim-1", status: "FAILED", serviceReportId: null })
        .mockResolvedValueOnce({ id: "claim-1", status: "IN_PROGRESS", serviceReportId: null }),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const { service } = buildHarness({ prisma: { serviceReportUploadIdempotencyKey: idemKey } });

    await expect(service.upload("cust-1", makeFile(), baseDto, actor, "contested-key")).rejects.toThrow(ConflictException);
    expect(idemKey.findUnique).toHaveBeenCalledTimes(2);
  });

  it("loses the create race on a brand-new key (P2002), re-reads, and resolves against the winner's state", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "5.22.0" });
    const idemKey = {
      findUnique: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "claim-1", status: "COMPLETED", serviceReportId: "sr-winner" }),
      create: jest.fn().mockRejectedValue(p2002),
      update: jest.fn(),
      updateMany: jest.fn(),
    };
    const { service, storage } = buildHarness({
      prisma: {
        serviceReportUploadIdempotencyKey: idemKey,
        serviceReport: { findUnique: jest.fn().mockResolvedValue({ id: "sr-winner", documentFileKey: "k", documentMimeType: "image/jpeg" }) },
      },
    });

    const result = await service.upload("cust-1", makeFile(), baseDto, actor, "raced-new-key");

    expect(result.id).toBe("sr-winner");
    expect(storage.putObject).not.toHaveBeenCalled(); // never proceeded — the winner already completed it
  });

  it("marks the claim FAILED (not left IN_PROGRESS) when the upload itself throws, and still surfaces the original error", async () => {
    const idemKey = {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "claim-1" }),
      update: jest.fn().mockResolvedValue(undefined),
      updateMany: jest.fn(),
    };
    const { service } = buildHarness({
      prisma: { serviceReportUploadIdempotencyKey: idemKey },
      storage: { putObject: jest.fn().mockRejectedValue(new Error("simulated storage outage")) },
    });

    await expect(service.upload("cust-1", makeFile(), baseDto, actor, "will-fail-key")).rejects.toThrow("simulated storage outage");
    expect(idemKey.update).toHaveBeenCalledWith({ where: { id: "claim-1" }, data: { status: "FAILED" } });
  });
});
