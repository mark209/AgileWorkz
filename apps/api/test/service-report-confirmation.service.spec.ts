import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { ServiceReportConfirmationService } from "../src/modules/service-report-confirmation/service-report-confirmation.service";
import { ConfirmationPlanBuilderService } from "../src/modules/service-report-confirmation/confirmation-plan-builder.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { AuditService } from "../src/modules/audit/audit.service";
import { mockOf } from "./test-utils";

const actor = { userId: "confirmer-1", ipAddress: "127.0.0.1", userAgent: "jest" };

const EQUIPMENT_TYPES = [{ code: "OTHER", label: "Other", status: "ACTIVE" }];
const PROBLEM_TYPES = [{ code: "NOT_OPERATIONAL", label: "Not Operational", status: "ACTIVE" }];
const MEASUREMENT_STAGES: unknown[] = [];
const MEASUREMENT_TYPES = [
  { code: "LOW_SIDE_PRESSURE", label: "Low Side Pressure", status: "ACTIVE" },
  { code: "OTHER_UNMAPPED", label: "Other / Unmapped", status: "ACTIVE" },
];

interface StagingRow {
  id: string;
  rowIndex: number;
  fieldName: string;
  reviewStatus: "CONFIRMED" | "CORRECTED" | "CONFIRMED_BLANK" | "NEEDS_FOLLOW_UP" | null;
  verifiedValue: string | null;
  aiUnit?: string | null;
  stage?: string | null;
  suggestedMeasurementTypeCode?: string | null;
}
function stagingRow(overrides: Partial<StagingRow> = {}): StagingRow {
  return { id: `row-${Math.random().toString(36).slice(2, 8)}`, rowIndex: 0, fieldName: "field", reviewStatus: "CONFIRMED", verifiedValue: "value", ...overrides };
}

/** Records every create() call per canonical delegate, and honors count()/findMany() against what's been created so far — good enough to exercise the real service logic without a real DB. */
function creatingDelegate(prefix: string) {
  const created: Array<{ id: string; data: Record<string, unknown> }> = [];
  let n = 0;
  return {
    created,
    delegate: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = `${prefix}-${n++}`;
        const row = { id, ...data };
        created.push({ id, data });
        return row;
      }),
      createMany: jest.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        for (const d of data) created.push({ id: `${prefix}-${n++}`, data: d });
        return { count: data.length };
      }),
      count: jest.fn(async () => created.length),
      findMany: jest.fn(async () => created.map((c) => ({ id: c.id, ...c.data }))),
    },
  };
}

function buildHarness(opts: { report?: Record<string, unknown>; categories?: Partial<Record<string, StagingRow[]>> } = {}) {
  const report = { id: "sr-1", status: "VERIFIED", ...opts.report };
  const categories = opts.categories ?? {};

  const equipmentUnitStore = creatingDelegate("eq");
  const problemStore = creatingDelegate("prob");
  const measurementStore = creatingDelegate("meas");
  const narrativeStore = creatingDelegate("narr");
  const signoffStore = creatingDelegate("sign");
  const technicianStore = creatingDelegate("tech");

  let currentStatus = report.status as string;
  const updateMany = jest.fn(async ({ where, data }: { where: { status?: string }; data: Record<string, unknown> }) => {
    if (where.status && where.status !== currentStatus) return { count: 0 };
    currentStatus = data.status as string;
    return { count: 1 };
  });
  const findUniqueOrThrow = jest.fn(async () => ({ ...report, status: currentStatus, confirmedBy: actor.userId, confirmedAt: new Date() }));

  const prismaShape = {
    serviceReport: { findUnique: jest.fn().mockResolvedValue(report), updateMany, findUniqueOrThrow },
    extractionBasicInfo: { findMany: jest.fn().mockResolvedValue(categories.basicInfo ?? []) },
    extractionEquipmentUnit: { findMany: jest.fn().mockResolvedValue(categories.equipmentUnit ?? []) },
    extractionProblem: { findMany: jest.fn().mockResolvedValue(categories.problem ?? []) },
    extractionMeasurement: { findMany: jest.fn().mockResolvedValue(categories.measurement ?? []) },
    extractionNarrativeItem: { findMany: jest.fn().mockResolvedValue(categories.narrativeItem ?? []) },
    extractionSignoff: { findMany: jest.fn().mockResolvedValue(categories.signoff ?? []) },
    equipmentType: { findMany: jest.fn().mockResolvedValue(EQUIPMENT_TYPES) },
    problemType: { findMany: jest.fn().mockResolvedValue(PROBLEM_TYPES) },
    measurementStage: { findMany: jest.fn().mockResolvedValue(MEASUREMENT_STAGES) },
    measurementType: { findMany: jest.fn().mockResolvedValue(MEASUREMENT_TYPES) },
    serviceReportEquipmentUnit: equipmentUnitStore.delegate,
    serviceReportProblem: problemStore.delegate,
    serviceReportMeasurement: measurementStore.delegate,
    serviceReportNarrativeItem: narrativeStore.delegate,
    serviceReportSignoff: signoffStore.delegate,
    serviceReportTechnician: technicianStore.delegate,
  };

  // $transaction(callback) runs the callback against the SAME mocked
  // delegate set, standing in for Prisma's real tx client — sufficient to
  // exercise confirm()'s actual read/write/guard logic without a real DB.
  const transactionFn = jest.fn(async (callback: (tx: typeof prismaShape) => Promise<unknown>) => callback(prismaShape));
  const prisma = mockOf<PrismaService>({ ...prismaShape, $transaction: transactionFn });

  const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
  const planBuilder = new ConfirmationPlanBuilderService(prisma);
  const service = new ServiceReportConfirmationService(prisma, planBuilder, audit);

  return { service, audit, prisma, stores: { equipmentUnitStore, problemStore, measurementStore, narrativeStore, signoffStore, technicianStore }, updateMany };
}

describe("ServiceReportConfirmationService.preview", () => {
  it("does not build a structured confirmation from document-only approval", async () => {
    const { service } = buildHarness({ report: { verificationBasis: "DOCUMENT_ONLY" } });
    await expect(service.preview("sr-1")).rejects.toThrow(BadRequestException);
    await expect(service.confirm("sr-1", actor)).rejects.toThrow(BadRequestException);
  });
  it("returns the plan without writing anything", async () => {
    const { service, stores } = buildHarness({ categories: { measurement: [stagingRow({ fieldName: "Low Side Pressure", suggestedMeasurementTypeCode: "LOW_SIDE_PRESSURE" })] } });
    const plan = await service.preview("sr-1");
    expect(plan.isConfirmable).toBe(true);
    expect(plan.measurements).toHaveLength(1);
    expect(stores.measurementStore.delegate.create).not.toHaveBeenCalled();
  });

  it("throws NotFoundException for a report that doesn't exist", async () => {
    const prisma = mockOf<PrismaService>({ serviceReport: { findUnique: jest.fn().mockResolvedValue(null) } });
    const service = new ServiceReportConfirmationService(prisma, new ConfirmationPlanBuilderService(prisma), mockOf<AuditService>({}));
    await expect(service.preview("missing")).rejects.toThrow(NotFoundException);
  });
});

describe("ServiceReportConfirmationService.confirm — happy path", () => {
  it("creates canonical rows, links equipment associations by rowIndex, transitions to CONFIRMED, and writes one audit entry", async () => {
    const { service, stores, audit, updateMany } = buildHarness({
      categories: {
        equipmentUnit: [stagingRow({ rowIndex: 0, fieldName: "Unit Tag", verifiedValue: "AC#1" })],
        measurement: [stagingRow({ rowIndex: 0, fieldName: "Low Side Pressure", verifiedValue: "65", aiUnit: "psi", suggestedMeasurementTypeCode: "LOW_SIDE_PRESSURE" })],
        problem: [stagingRow({ fieldName: "NOT OPERATIONAL", verifiedValue: "checked" })],
        signoff: [stagingRow({ fieldName: "Technician Signature", verifiedValue: "John Arnold Candia" })],
      },
    });

    const result = await service.confirm("sr-1", actor);

    expect(result.report.status).toBe("CONFIRMED");
    expect(result.createdCounts).toEqual({ technicians: 0, equipmentUnits: 1, problems: 1, measurements: 1, narrativeItems: 0, signoffs: 1 });

    // The measurement's equipmentUnitId resolves to the equipment unit created moments earlier in the same transaction, by matching rowIndex.
    expect(stores.measurementStore.created[0].data.equipmentUnitId).toBe(stores.equipmentUnitStore.created[0].id);

    expect(updateMany).toHaveBeenCalledWith({ where: { id: "sr-1", status: "VERIFIED" }, data: expect.objectContaining({ status: "CONFIRMED", confirmedBy: actor.userId }) });
    expect(audit.write).toHaveBeenCalledTimes(1);
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: "service_report_confirmed" }), expect.anything());
  });
});

describe("ServiceReportConfirmationService.confirm — validation and idempotency", () => {
  it("refuses when the report is not VERIFIED", async () => {
    const { service } = buildHarness({ report: { status: "PENDING_VERIFICATION" } });
    await expect(service.confirm("sr-1", actor)).rejects.toThrow(BadRequestException);
  });

  it("refuses when any staging field is unreviewed", async () => {
    const { service } = buildHarness({ categories: { measurement: [stagingRow({ reviewStatus: null })] } });
    await expect(service.confirm("sr-1", actor)).rejects.toThrow(BadRequestException);
  });

  it("refuses when any staging field is NEEDS_FOLLOW_UP", async () => {
    const { service } = buildHarness({ categories: { measurement: [stagingRow({ reviewStatus: "NEEDS_FOLLOW_UP", verifiedValue: null })] } });
    await expect(service.confirm("sr-1", actor)).rejects.toThrow(BadRequestException);
  });

  it("never overwrites aiValue/aiConfidence/aiUnit/suggestedMeasurementTypeCode — the confirm path never calls update on any staging delegate", async () => {
    const { service, prisma } = buildHarness({ categories: { measurement: [stagingRow({ fieldName: "Low Side Pressure", suggestedMeasurementTypeCode: "LOW_SIDE_PRESSURE" })] } });
    await service.confirm("sr-1", actor);
    expect((prisma as unknown as { extractionMeasurement: { update?: unknown } }).extractionMeasurement.update).toBeUndefined();
  });

  it("rejects a second concurrent confirm attempt once the first has already transitioned the report — exactly one succeeds, no duplicate canonical rows", async () => {
    const { service, stores } = buildHarness({
      categories: { measurement: [stagingRow({ fieldName: "Low Side Pressure", suggestedMeasurementTypeCode: "LOW_SIDE_PRESSURE" })] },
    });

    await service.confirm("sr-1", actor);
    expect(stores.measurementStore.created).toHaveLength(1);

    // A second attempt against the same report: this mock's
    // serviceReport.findUnique always returns the original static row
    // (unlike a real DB, it doesn't reflect the first call's update), so
    // this exercises specifically the defense-in-depth "canonical data
    // already exists" guard rather than the ALREADY_CONFIRMED validation
    // path a real re-read would hit first — both are real, independent
    // safety nets against a duplicate confirm, and this proves the second
    // one catches it even when the first one's signal is stale.
    await expect(service.confirm("sr-1", actor)).rejects.toThrow(ConflictException);
    expect(stores.measurementStore.created).toHaveLength(1); // still exactly one — never duplicated
  });

  it("refuses via the atomic status guard if the report is no longer VERIFIED by the time the update runs (simulated race)", async () => {
    const { service, updateMany, stores } = buildHarness({
      categories: { measurement: [stagingRow({ fieldName: "Low Side Pressure", suggestedMeasurementTypeCode: "LOW_SIDE_PRESSURE" })] },
    });
    // Simulate a concurrent winner having already flipped the status the
    // instant before this call's own guarded updateMany runs.
    updateMany.mockImplementationOnce(async () => ({ count: 0 }));

    await expect(service.confirm("sr-1", actor)).rejects.toThrow(ConflictException);
    // Every canonical row this (losing) call created is discarded — in a
    // real Postgres transaction this is an automatic rollback; this mock
    // harness can't simulate the rollback itself, but the important,
    // independently-verified guarantee is that the caller sees the whole
    // operation fail, never a partially-confirmed report.
    void stores;
  });

  it("refuses outright if canonical data already exists for this report (defense in depth beyond the status check)", async () => {
    const { service, stores } = buildHarness({
      categories: { measurement: [stagingRow({ fieldName: "Low Side Pressure", suggestedMeasurementTypeCode: "LOW_SIDE_PRESSURE" })] },
    });
    stores.signoffStore.created.push({ id: "sign-preexisting", data: {} });
    await expect(service.confirm("sr-1", actor)).rejects.toThrow(ConflictException);
  });
});

describe("ServiceReportConfirmationService.lock", () => {
  it("transitions CONFIRMED -> LOCKED, sets lockedBy/lockedAt, and writes exactly one audit entry inside the transaction", async () => {
    const { service, audit, updateMany } = buildHarness({ report: { status: "CONFIRMED" } });

    const result = await service.lock("sr-1", actor);

    expect(result.status).toBe("LOCKED");
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "sr-1", status: "CONFIRMED" },
      data: expect.objectContaining({ status: "LOCKED", lockedBy: actor.userId }),
    });
    expect(audit.write).toHaveBeenCalledTimes(1);
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "service_report_locked",
        actorUserId: actor.userId,
        beforeData: { status: "CONFIRMED" },
        afterData: { status: "LOCKED" },
      }),
      expect.anything(),
    );
  });

  it("never touches any canonical detail table", async () => {
    const { service, stores } = buildHarness({ report: { status: "CONFIRMED" } });
    await service.lock("sr-1", actor);
    expect(stores.equipmentUnitStore.delegate.create).not.toHaveBeenCalled();
    expect(stores.problemStore.delegate.create).not.toHaveBeenCalled();
    expect(stores.measurementStore.delegate.create).not.toHaveBeenCalled();
    expect(stores.narrativeStore.delegate.create).not.toHaveBeenCalled();
    expect(stores.signoffStore.delegate.create).not.toHaveBeenCalled();
    expect(stores.technicianStore.delegate.create).not.toHaveBeenCalled();
    expect(stores.technicianStore.delegate.createMany).not.toHaveBeenCalled();
  });

  it("refuses for every non-CONFIRMED status, including PENDING_VERIFICATION, VERIFIED, and already-LOCKED", async () => {
    for (const status of ["PENDING_VERIFICATION", "VERIFIED", "LOCKED", "EXTRACTION_FAILED"]) {
      const { service } = buildHarness({ report: { status } });
      await expect(service.lock("sr-1", actor)).rejects.toThrow(BadRequestException);
    }
  });

  it("throws NotFoundException for a report that doesn't exist", async () => {
    const prisma = mockOf<PrismaService>({
      $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(mockOf({ serviceReport: { findUnique: async () => null } })),
    });
    const service = new ServiceReportConfirmationService(prisma, new ConfirmationPlanBuilderService(prisma), mockOf<AuditService>({}));
    await expect(service.lock("missing", actor)).rejects.toThrow(NotFoundException);
  });

  it("rejects a second lock attempt via the atomic guard — no double-lock", async () => {
    const { service } = buildHarness({ report: { status: "CONFIRMED" } });
    await service.lock("sr-1", actor);
    // See the equivalent confirm() test's comment above: this mock's
    // findUnique pre-check always returns the original static row, so this
    // exercises the guarded updateMany specifically (currentStatus is
    // correctly tracked there) rather than the earlier status pre-check —
    // both are real, independent guards against a duplicate lock.
    await expect(service.lock("sr-1", actor)).rejects.toThrow(ConflictException);
  });

  it("refuses via the atomic guard if the report is no longer CONFIRMED by the time the update runs (simulated race)", async () => {
    const { service, updateMany } = buildHarness({ report: { status: "CONFIRMED" } });
    updateMany.mockImplementationOnce(async () => ({ count: 0 }));
    await expect(service.lock("sr-1", actor)).rejects.toThrow(ConflictException);
  });
});
