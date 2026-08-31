import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { ServiceReportVerificationService } from "../src/modules/service-report-verification/service-report-verification.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { AuditService } from "../src/modules/audit/audit.service";
import { StorageProvider } from "../src/common/storage/storage-provider.interface";
import { mockOf } from "./test-utils";

const actor = { userId: "verifier-1", ipAddress: "127.0.0.1", userAgent: "jest" };

interface Row {
  id: string;
  serviceReportId: string;
  rowIndex: number;
  fieldName: string;
  aiValue: string | null;
  aiConfidence: "HIGH" | "MEDIUM" | "LOW" | "UNREADABLE" | null;
  requiresHumanVerification: boolean;
  reviewStatus: "CONFIRMED" | "CORRECTED" | "CONFIRMED_BLANK" | "NEEDS_FOLLOW_UP" | null;
  verifiedValue: string | null;
  verifiedBy: string | null;
  verifiedAt: Date | null;
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: `row-${Math.random().toString(36).slice(2, 8)}`,
    serviceReportId: "sr-1",
    rowIndex: 0,
    fieldName: "field",
    aiValue: "42",
    aiConfidence: "HIGH",
    requiresHumanVerification: false,
    reviewStatus: null,
    verifiedValue: null,
    verifiedBy: null,
    verifiedAt: null,
    ...overrides,
  };
}

// A realistic in-memory stand-in for one extraction_* Prisma delegate —
// findFirst/findMany/update/count all read/write the same backing array,
// so a test can update a row and then assert on a subsequent findMany/count
// without manually chaining mockResolvedValueOnce calls.
function delegateStore(initialRows: Row[]) {
  const rows = initialRows.map((r) => ({ ...r }));
  return {
    rows,
    delegate: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; serviceReportId: string } }) =>
        rows.find((r) => r.id === where.id && r.serviceReportId === where.serviceReportId) ?? null,
      ),
      findMany: jest.fn(async ({ where }: { where: { serviceReportId: string } }) =>
        rows.filter((r) => r.serviceReportId === where.serviceReportId),
      ),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const idx = rows.findIndex((r) => r.id === where.id);
        rows[idx] = { ...rows[idx], ...data };
        return rows[idx];
      }),
      count: jest.fn(async ({ where }: { where: { serviceReportId: string; reviewStatus?: unknown } }) =>
        rows.filter((r) => {
          if (r.serviceReportId !== where.serviceReportId) return false;
          if ("reviewStatus" in where) return r.reviewStatus === where.reviewStatus;
          return true;
        }).length,
      ),
    },
  };
}

interface Harness {
  service: ServiceReportVerificationService;
  audit: ReturnType<typeof mockOf<AuditService>>;
  storage: ReturnType<typeof mockOf<StorageProvider>>;
  stores: {
    basicInfo: ReturnType<typeof delegateStore>;
    equipmentUnit: ReturnType<typeof delegateStore>;
    problem: ReturnType<typeof delegateStore>;
    measurement: ReturnType<typeof delegateStore>;
    narrativeItem: ReturnType<typeof delegateStore>;
    signoff: ReturnType<typeof delegateStore>;
  };
  reportUpdate: jest.Mock;
}

function buildHarness(opts: { report?: Record<string, unknown>; measurementRows?: Row[] } = {}): Harness {
  const stores = {
    basicInfo: delegateStore([]),
    equipmentUnit: delegateStore([]),
    problem: delegateStore([]),
    measurement: delegateStore(opts.measurementRows ?? []),
    narrativeItem: delegateStore([]),
    signoff: delegateStore([]),
  };

  const report = {
    id: "sr-1",
    status: "PENDING_VERIFICATION",
    reportTypeCode: "MAINTENANCE_CLEANING",
    documentFileKey: "key-1",
    documentFileName: "report.jpg",
    documentMimeType: "image/jpeg",
    uploadedBy: "uploader-1",
    uploadedAt: new Date("2026-01-01"),
    verifiedBy: null,
    verifiedAt: null,
    ...opts.report,
  };

  const reportUpdate = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...report, ...data }));

  // Phase 7 Wave 1 (F3.1) — completeVerification() now runs its status
  // transition through $transaction + a guarded updateMany (same pattern
  // as WorkOrdersService.startOwn), not a plain update. This stand-in
  // mutates the same `report` object the rest of the harness already
  // shares, so a real status guard actually applies: updateMany "fails"
  // (count: 0) if the where-clause's expected status no longer matches,
  // exactly mirroring what a real concurrent-status-change would do.
  const reportUpdateMany = jest.fn(async ({ where, data }: { where: { status?: string }; data: Record<string, unknown> }) => {
    if (where.status !== undefined && report.status !== where.status) return { count: 0 };
    Object.assign(report, data);
    return { count: 1 };
  });
  const reportFindUniqueOrThrow = jest.fn(async () => report);
  const transactionFn = jest.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({ serviceReport: { updateMany: reportUpdateMany, findUniqueOrThrow: reportFindUniqueOrThrow } }),
  );

  const prisma = mockOf<PrismaService>({
    serviceReport: { findUnique: jest.fn().mockResolvedValue(report), update: reportUpdate },
    extractionBasicInfo: stores.basicInfo.delegate,
    extractionEquipmentUnit: stores.equipmentUnit.delegate,
    extractionProblem: stores.problem.delegate,
    extractionMeasurement: stores.measurement.delegate,
    extractionNarrativeItem: stores.narrativeItem.delegate,
    extractionSignoff: stores.signoff.delegate,
    $transaction: transactionFn,
  });

  const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
  const storage = mockOf<StorageProvider>({ getSignedUrl: jest.fn().mockResolvedValue("https://signed.example/report.jpg") });

  const service = new ServiceReportVerificationService(prisma, storage, audit);
  return { service, audit, storage, stores, reportUpdate };
}

describe("ServiceReportVerificationService.getVerificationView", () => {
  it("returns fields grouped by category with a signed document URL", async () => {
    const { service, storage } = buildHarness({ measurementRows: [row({ fieldName: "low_side_pressure", aiValue: "65" })] });
    const view = await service.getVerificationView("sr-1");

    expect(storage.getSignedUrl).toHaveBeenCalledWith("key-1");
    expect(view.documentUrl).toBe("https://signed.example/report.jpg");
    expect(view.fields.measurement).toHaveLength(1);
    expect(view.fields.measurement[0].fieldName).toBe("low_side_pressure");
    expect(view.fields.basicInfo).toEqual([]);
  });

  it("throws NotFoundException for an unknown report", async () => {
    const prisma = mockOf<PrismaService>({ serviceReport: { findUnique: jest.fn().mockResolvedValue(null) } });
    const bad = new ServiceReportVerificationService(prisma, mockOf<StorageProvider>({}), mockOf<AuditService>({}));
    await expect(bad.getVerificationView("missing")).rejects.toThrow(NotFoundException);
  });
});

describe("ServiceReportVerificationService.submitFieldReview", () => {
  it("CONFIRMED copies aiValue and never trusts a client-submitted value", async () => {
    const { service, audit } = buildHarness({ measurementRows: [row({ id: "m1", aiValue: "65", fieldName: "low_side_pressure" })] });
    const result = await service.submitFieldReview("sr-1", "measurement", "m1", { reviewStatus: "CONFIRMED", verifiedValue: "999" } as never, actor);

    expect(result.verifiedValue).toBe("65"); // NOT "999" — CONFIRMED always copies aiValue
    expect(result.reviewStatus).toBe("CONFIRMED");
    expect(result.verifiedBy).toBe(actor.userId);
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: "service_report_verification_field_reviewed" }));
  });

  it("never includes aiValue/aiConfidence in the update payload — immutability is structural", async () => {
    const { service, stores } = buildHarness({ measurementRows: [row({ id: "m1", aiValue: "65", aiConfidence: "HIGH" })] });
    await service.submitFieldReview("sr-1", "measurement", "m1", { reviewStatus: "CONFIRMED" } as never, actor);

    const updateCall = stores.measurement.delegate.update.mock.calls[0][0];
    expect(updateCall.data).not.toHaveProperty("aiValue");
    expect(updateCall.data).not.toHaveProperty("aiConfidence");
    expect(updateCall.data).not.toHaveProperty("aiUnit");
    expect(updateCall.data).not.toHaveProperty("suggestedMeasurementTypeCode");
    // original ai fields on the row itself remain untouched
    expect(stores.measurement.rows.find((r) => r.id === "m1")!.aiValue).toBe("65");
  });

  it("CORRECTED requires verifiedValue and rejects when absent", async () => {
    const { service } = buildHarness({ measurementRows: [row({ id: "m1", aiValue: "65" })] });
    await expect(service.submitFieldReview("sr-1", "measurement", "m1", { reviewStatus: "CORRECTED" } as never, actor)).rejects.toThrow(BadRequestException);
  });

  it("CORRECTED stores the reviewer's own value, distinct from aiValue", async () => {
    const { service } = buildHarness({ measurementRows: [row({ id: "m1", aiValue: "65" })] });
    const result = await service.submitFieldReview("sr-1", "measurement", "m1", { reviewStatus: "CORRECTED", verifiedValue: "68" } as never, actor);
    expect(result.verifiedValue).toBe("68");
    expect(result.reviewStatus).toBe("CORRECTED");
  });

  it("CONFIRMED_BLANK forces verifiedValue to null, distinct from an unreviewed blank", async () => {
    const { service } = buildHarness({ measurementRows: [row({ id: "m1", aiValue: null, reviewStatus: null })] });
    const result = await service.submitFieldReview("sr-1", "measurement", "m1", { reviewStatus: "CONFIRMED_BLANK" } as never, actor);
    expect(result.verifiedValue).toBeNull();
    expect(result.reviewStatus).toBe("CONFIRMED_BLANK"); // not null — explicitly reviewed
  });

  it("NEEDS_FOLLOW_UP forces verifiedValue to null and records the flag", async () => {
    const { service } = buildHarness({ measurementRows: [row({ id: "m1", aiValue: "??", aiConfidence: "LOW" })] });
    const result = await service.submitFieldReview("sr-1", "measurement", "m1", { reviewStatus: "NEEDS_FOLLOW_UP" } as never, actor);
    expect(result.verifiedValue).toBeNull();
    expect(result.reviewStatus).toBe("NEEDS_FOLLOW_UP");
  });

  it("rejects when the report is not PENDING_VERIFICATION", async () => {
    const { service } = buildHarness({ report: { status: "VERIFIED" }, measurementRows: [row({ id: "m1" })] });
    await expect(service.submitFieldReview("sr-1", "measurement", "m1", { reviewStatus: "CONFIRMED" } as never, actor)).rejects.toThrow(BadRequestException);
  });

  it("throws NotFoundException for a row that doesn't belong to this report", async () => {
    const { service } = buildHarness({ measurementRows: [row({ id: "m1", serviceReportId: "sr-OTHER" })] });
    await expect(service.submitFieldReview("sr-1", "measurement", "m1", { reviewStatus: "CONFIRMED" } as never, actor)).rejects.toThrow(NotFoundException);
  });
});

describe("ServiceReportVerificationService bulk confirm", () => {
  function eligibilityFixture() {
    return [
      row({ id: "eligible-1", aiValue: "220", aiConfidence: "HIGH", requiresHumanVerification: false, reviewStatus: null }),
      row({ id: "eligible-2", aiValue: "30", aiConfidence: "MEDIUM", requiresHumanVerification: false, reviewStatus: null }),
      row({ id: "low-confidence", aiValue: "17", aiConfidence: "LOW", requiresHumanVerification: false, reviewStatus: null }),
      row({ id: "flagged", aiValue: "410", aiConfidence: "HIGH", requiresHumanVerification: true, reviewStatus: null }),
      row({ id: "unreadable", aiValue: "??", aiConfidence: "UNREADABLE", requiresHumanVerification: false, reviewStatus: null }),
      row({ id: "blank", aiValue: null, aiConfidence: null, requiresHumanVerification: false, reviewStatus: null }),
      row({ id: "already-confirmed", aiValue: "15", aiConfidence: "HIGH", requiresHumanVerification: false, reviewStatus: "CONFIRMED", verifiedValue: "15" }),
      row({ id: "already-needs-follow-up", aiValue: "9", aiConfidence: "LOW", requiresHumanVerification: false, reviewStatus: "NEEDS_FOLLOW_UP" }),
    ];
  }

  it("preview counts exactly the eligible fields: HIGH/MEDIUM confidence, has a value, not flagged, not already reviewed", async () => {
    const { service } = buildHarness({ measurementRows: eligibilityFixture() });
    const preview = await service.previewBulkConfirm("sr-1");
    expect(preview.eligibleCount).toBe(2);
    expect(preview.eligibleFields.map((f) => f.id).sort()).toEqual(["eligible-1", "eligible-2"]);
  });

  it("excludes LOW-confidence fields from bulk confirmation, even when otherwise eligible-looking", async () => {
    const { service, stores } = buildHarness({ measurementRows: eligibilityFixture() });
    const preview = await service.previewBulkConfirm("sr-1");
    expect(preview.eligibleFields.map((f) => f.id)).not.toContain("low-confidence");

    await service.bulkConfirmEligibleFields("sr-1", actor);
    expect(stores.measurement.rows.find((r) => r.id === "low-confidence")!.reviewStatus).toBeNull();
  });

  it("bulk-confirms only the eligible fields, leaving flagged/unreadable/low-confidence/blank/already-reviewed untouched", async () => {
    const { service, stores, audit } = buildHarness({ measurementRows: eligibilityFixture() });
    const result = await service.bulkConfirmEligibleFields("sr-1", actor);

    expect(result.confirmedCount).toBe(2);
    const byId = Object.fromEntries(stores.measurement.rows.map((r) => [r.id, r]));
    expect(byId["eligible-1"].reviewStatus).toBe("CONFIRMED");
    expect(byId["eligible-1"].verifiedValue).toBe("220");
    expect(byId["eligible-1"].verifiedBy).toBe(actor.userId);
    expect(byId["eligible-2"].reviewStatus).toBe("CONFIRMED");

    // untouched
    expect(byId["low-confidence"].reviewStatus).toBeNull();
    expect(byId["flagged"].reviewStatus).toBeNull();
    expect(byId["unreadable"].reviewStatus).toBeNull();
    expect(byId["blank"].reviewStatus).toBeNull();
    expect(byId["already-confirmed"].verifiedValue).toBe("15"); // unchanged, not re-written
    expect(byId["already-needs-follow-up"].reviewStatus).toBe("NEEDS_FOLLOW_UP");

    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "service_report_verification_bulk_confirmed",
        afterData: expect.objectContaining({ confirmedCount: 2 }),
      }),
    );
  });

  it("never auto-confirms a blank field even when otherwise eligible-looking", async () => {
    const { service, stores } = buildHarness({
      measurementRows: [row({ id: "blank-only", aiValue: null, aiConfidence: null, requiresHumanVerification: false, reviewStatus: null })],
    });
    await service.bulkConfirmEligibleFields("sr-1", actor);
    expect(stores.measurement.rows[0].reviewStatus).toBeNull();
  });

  it("rejects bulk confirm when the report is not PENDING_VERIFICATION", async () => {
    const { service } = buildHarness({ report: { status: "VERIFIED" } });
    await expect(service.bulkConfirmEligibleFields("sr-1", actor)).rejects.toThrow(BadRequestException);
  });
});

describe("ServiceReportVerificationService.completeVerification", () => {
  it("blocks VERIFIED transition while any field is unreviewed", async () => {
    const { service } = buildHarness({ measurementRows: [row({ id: "m1", reviewStatus: null })] });
    await expect(service.completeVerification("sr-1", actor)).rejects.toThrow(BadRequestException);
  });

  it("blocks VERIFIED transition while any field is NEEDS_FOLLOW_UP, even if every other field is resolved", async () => {
    const { service } = buildHarness({
      measurementRows: [
        row({ id: "m1", reviewStatus: "CONFIRMED", verifiedValue: "65" }),
        row({ id: "m2", reviewStatus: "NEEDS_FOLLOW_UP" }),
      ],
    });
    await expect(service.completeVerification("sr-1", actor)).rejects.toThrow(BadRequestException);
  });

  it("does not introduce a VERIFIED_WITH_EXCEPTION status — the report simply stays PENDING_VERIFICATION when blocked", async () => {
    const { service, reportUpdate } = buildHarness({ measurementRows: [row({ id: "m1", reviewStatus: "NEEDS_FOLLOW_UP" })] });
    await expect(service.completeVerification("sr-1", actor)).rejects.toThrow(BadRequestException);
    expect(reportUpdate).not.toHaveBeenCalled();
  });

  it("transitions to VERIFIED once every field is CONFIRMED, CORRECTED, or CONFIRMED_BLANK, and audits it", async () => {
    const { service, audit } = buildHarness({
      measurementRows: [
        row({ id: "m1", reviewStatus: "CONFIRMED", verifiedValue: "65" }),
        row({ id: "m2", reviewStatus: "CORRECTED", verifiedValue: "68" }),
        row({ id: "m3", aiValue: null, reviewStatus: "CONFIRMED_BLANK", verifiedValue: null }),
      ],
    });
    const updated = await service.completeVerification("sr-1", actor);
    expect(updated.status).toBe("VERIFIED");
    expect(updated.verifiedBy).toBe(actor.userId);
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: "service_report_verified" }));
  });

  it("allows VERIFIED with zero measurement rows at all (an entirely blank technical-data report, fully reviewed elsewhere)", async () => {
    const { service } = buildHarness({ measurementRows: [] });
    const updated = await service.completeVerification("sr-1", actor);
    expect(updated.status).toBe("VERIFIED");
  });

  it("rejects completing verification twice", async () => {
    const { service } = buildHarness({ report: { status: "CONFIRMED" } });
    await expect(service.completeVerification("sr-1", actor)).rejects.toThrow(BadRequestException);
  });

  // Phase 7 Wave 1 (F3.1) — the guard itself: a report that reads as
  // PENDING_VERIFICATION at the top of the method but has already been
  // transitioned by someone else by the time the guarded updateMany
  // actually runs (a genuine concurrent completion) must surface as a
  // clean 409-mapped ConflictException, never a silent double-write. The
  // e2e-level "only one of two concurrent completion requests... succeeds"
  // test proves this against a real DB; this proves the same guard logic
  // in isolation, independent of real concurrency/timing.
  it("throws ConflictException when the guarded update finds the report no longer PENDING_VERIFICATION", async () => {
    const report = { id: "sr-1", status: "PENDING_VERIFICATION" };
    const prisma = mockOf<PrismaService>({
      serviceReport: { findUnique: jest.fn().mockResolvedValue(report) },
      extractionBasicInfo: { count: jest.fn().mockResolvedValue(0) },
      extractionEquipmentUnit: { count: jest.fn().mockResolvedValue(0) },
      extractionProblem: { count: jest.fn().mockResolvedValue(0) },
      extractionMeasurement: { count: jest.fn().mockResolvedValue(0) },
      extractionNarrativeItem: { count: jest.fn().mockResolvedValue(0) },
      extractionSignoff: { count: jest.fn().mockResolvedValue(0) },
      // Simulates another request having already won the race — the
      // guard's own WHERE clause no longer matches, exactly as it
      // wouldn't against a real DB in the same situation.
      $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({ serviceReport: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } }),
      ),
    });
    const service = new ServiceReportVerificationService(prisma, mockOf<StorageProvider>({}), mockOf<AuditService>({}));
    await expect(service.completeVerification("sr-1", actor)).rejects.toThrow(ConflictException);
  });
});
