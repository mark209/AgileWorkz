import { ConfirmationPlanBuilderService } from "../src/modules/service-report-confirmation/confirmation-plan-builder.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { mockOf } from "./test-utils";

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

const EQUIPMENT_TYPES = [
  { code: "SPLIT_INDOOR", label: "Split Type — Indoor Unit", status: "ACTIVE" },
  { code: "OTHER", label: "Other", status: "ACTIVE" },
];
const PROBLEM_TYPES = [{ code: "NOT_OPERATIONAL", label: "Not Operational", status: "ACTIVE" }];
const MEASUREMENT_STAGES = [
  { code: "BEFORE_CLEANING", label: "Before Cleaning", status: "ACTIVE" },
  { code: "AFTER_CLEANING", label: "After Cleaning", status: "ACTIVE" },
];
const MEASUREMENT_TYPES = [
  { code: "LOW_SIDE_PRESSURE", label: "Low Side Pressure", status: "ACTIVE" },
  { code: "OTHER_UNMAPPED", label: "Other / Unmapped", status: "ACTIVE" },
];

function buildDb(
  categories: Partial<{
    basicInfo: StagingRow[];
    equipmentUnit: StagingRow[];
    problem: StagingRow[];
    measurement: StagingRow[];
    narrativeItem: StagingRow[];
    signoff: StagingRow[];
  }> = {},
  reportOverrides: Record<string, unknown> = {},
) {
  const report = { id: "sr-1", status: "VERIFIED", ...reportOverrides };
  return mockOf<PrismaService>({
    serviceReport: { findUnique: jest.fn().mockResolvedValue(report) },
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
  });
}

describe("ConfirmationPlanBuilderService.buildPlan — validation", () => {
  const builder = new ConfirmationPlanBuilderService(mockOf<PrismaService>({}));

  it("is not confirmable when the report is not VERIFIED", async () => {
    const db = buildDb({}, { status: "PENDING_VERIFICATION" });
    const plan = await builder.buildPlan(db, "sr-1");
    expect(plan.isConfirmable).toBe(false);
    expect(plan.validationIssues[0].code).toBe("NOT_VERIFIED");
  });

  it("reports ALREADY_CONFIRMED distinctly when the report is already CONFIRMED", async () => {
    const db = buildDb({}, { status: "CONFIRMED" });
    const plan = await builder.buildPlan(db, "sr-1");
    expect(plan.validationIssues[0].code).toBe("ALREADY_CONFIRMED");
  });

  it("is not confirmable while any staging row is unreviewed", async () => {
    const db = buildDb({ measurement: [stagingRow({ reviewStatus: null })] });
    const plan = await builder.buildPlan(db, "sr-1");
    expect(plan.isConfirmable).toBe(false);
    expect(plan.validationIssues.some((i) => i.code === "UNREVIEWED_FIELDS")).toBe(true);
  });

  it("is not confirmable while any staging row is NEEDS_FOLLOW_UP", async () => {
    const db = buildDb({ measurement: [stagingRow({ reviewStatus: "NEEDS_FOLLOW_UP", verifiedValue: null })] });
    const plan = await builder.buildPlan(db, "sr-1");
    expect(plan.isConfirmable).toBe(false);
    expect(plan.validationIssues.some((i) => i.code === "NEEDS_FOLLOW_UP")).toBe(true);
  });

  it("is confirmable when every row is reviewed and none needs follow-up", async () => {
    const db = buildDb({ measurement: [stagingRow({ reviewStatus: "CONFIRMED" })] });
    const plan = await builder.buildPlan(db, "sr-1");
    expect(plan.isConfirmable).toBe(true);
    expect(plan.validationIssues).toEqual([]);
  });
});

describe("ConfirmationPlanBuilderService.buildPlan — basicInfo", () => {
  const builder = new ConfirmationPlanBuilderService(mockOf<PrismaService>({}));

  it("maps recognized header fields, parses a written-out date, and skips a CONFIRMED_BLANK field", async () => {
    const db = buildDb({
      basicInfo: [
        stagingRow({ fieldName: "Work Date", verifiedValue: "August 28, 2026" }),
        stagingRow({ fieldName: "Contact Person / Tel No.", reviewStatus: "CONFIRMED_BLANK", verifiedValue: null }),
        stagingRow({ fieldName: "Report Reference Number", verifiedValue: "SR-0119" }),
      ],
    });
    const plan = await builder.buildPlan(db, "sr-1");
    expect(plan.header.serviceDate?.toISOString().slice(0, 10)).toBe("2026-08-28");
    expect(plan.header.reportReferenceNumber).toBe("SR-0119");
    expect(plan.header.contactName).toBeNull();
  });

  it("preserves a CORRECTED value distinct from what the AI originally reported", async () => {
    const db = buildDb({ basicInfo: [stagingRow({ fieldName: "Work Date", reviewStatus: "CORRECTED", verifiedValue: "August 27, 2026" })] });
    const plan = await builder.buildPlan(db, "sr-1");
    expect(plan.header.serviceDate?.toISOString().slice(0, 10)).toBe("2026-08-27");
  });

  it("collects repeating technician-name rows into separate technicians, in row order", async () => {
    const db = buildDb({
      basicInfo: [
        stagingRow({ fieldName: "Technician Name", rowIndex: 1, verifiedValue: "Juan Dela Cruz" }),
        stagingRow({ fieldName: "Technician Name", rowIndex: 2, verifiedValue: "Maria Santos" }),
      ],
    });
    const plan = await builder.buildPlan(db, "sr-1");
    expect(plan.technicians.map((t) => t.technicianName)).toEqual(["Juan Dela Cruz", "Maria Santos"]);
  });

  it("never drops an unrecognized field — folds it into generalNotes labeled with its own fieldName", async () => {
    const db = buildDb({ basicInfo: [stagingRow({ fieldName: "Some Unexpected Header Field", verifiedValue: "unexpected text" })] });
    const plan = await builder.buildPlan(db, "sr-1");
    expect(plan.header.generalNotes).toContain("Some Unexpected Header Field: unexpected text");
  });

  it("falls back to generalNotes (never silently drops) an unparseable date", async () => {
    const db = buildDb({ basicInfo: [stagingRow({ fieldName: "Work Date", verifiedValue: "sometime last week" })] });
    const plan = await builder.buildPlan(db, "sr-1");
    expect(plan.header.serviceDate).toBeNull();
    expect(plan.header.generalNotes).toContain("Work Date: sometime last week");
    expect(plan.warnings.some((w) => w.includes("could not be parsed as a date"))).toBe(true);
  });
});

describe("ConfirmationPlanBuilderService.buildPlan — equipment units (Decision 2 & 4)", () => {
  const builder = new ConfirmationPlanBuilderService(mockOf<PrismaService>({}));

  it("skips an entire equipment-unit group that is all blank — never creates an empty record", async () => {
    const db = buildDb({ equipmentUnit: [stagingRow({ rowIndex: 0, fieldName: "Unit Tag", reviewStatus: "CONFIRMED_BLANK", verifiedValue: null })] });
    const plan = await builder.buildPlan(db, "sr-1");
    expect(plan.equipmentUnits).toEqual([]);
    expect(plan.skipped).toContainEqual(expect.objectContaining({ category: "equipmentUnit", rowIndex: 0 }));
  });

  it("creates a canonical row when at least one field in the group is populated, leaving other fields null", async () => {
    const db = buildDb({
      equipmentUnit: [
        stagingRow({ rowIndex: 0, fieldName: "Unit Tag", verifiedValue: "AC#1" }),
        stagingRow({ rowIndex: 0, fieldName: "Location", reviewStatus: "CONFIRMED_BLANK", verifiedValue: null }),
      ],
    });
    const plan = await builder.buildPlan(db, "sr-1");
    expect(plan.equipmentUnits).toHaveLength(1);
    expect(plan.equipmentUnits[0].unitTag).toBe("AC#1");
    expect(plan.equipmentUnits[0].location).toBeNull();
  });

  it("falls back to OTHER and preserves the original free text in description when the type can't be matched", async () => {
    const db = buildDb({ equipmentUnit: [stagingRow({ rowIndex: 0, fieldName: "Equipment Type", verifiedValue: "Window-type aircon, customer's own wording" })] });
    const plan = await builder.buildPlan(db, "sr-1");
    expect(plan.equipmentUnits[0].equipmentTypeCode).toBe("OTHER");
    expect(plan.equipmentUnits[0].equipmentTypeResolution).toBe("fallback_other");
    expect(plan.equipmentUnits[0].description).toContain("Window-type aircon, customer's own wording");
  });

  it("resolves an equipment type via an exact, non-fuzzy match against the seeded taxonomy label", async () => {
    const db = buildDb({ equipmentUnit: [stagingRow({ rowIndex: 0, fieldName: "Equipment Type", verifiedValue: "Split Type — Indoor Unit" })] });
    const plan = await builder.buildPlan(db, "sr-1");
    expect(plan.equipmentUnits[0].equipmentTypeCode).toBe("SPLIT_INDOOR");
    expect(plan.equipmentUnits[0].equipmentTypeResolution).toBe("matched");
  });
});

describe("ConfirmationPlanBuilderService.buildPlan — problems (checkbox-aware, Decision 4)", () => {
  const builder = new ConfirmationPlanBuilderService(mockOf<PrismaService>({}));

  it("skips an unchecked checkbox — never creates a record for a problem that wasn't found", async () => {
    const db = buildDb({ problem: [stagingRow({ fieldName: "NOT OPERATIONAL", verifiedValue: "unchecked" })] });
    const plan = await builder.buildPlan(db, "sr-1");
    expect(plan.problems).toEqual([]);
    expect(plan.skipped).toContainEqual(expect.objectContaining({ category: "problem" }));
  });

  it("uses the checkbox's own printed label as the description when checked, and resolves its problem type", async () => {
    const db = buildDb({ problem: [stagingRow({ fieldName: "NOT OPERATIONAL", verifiedValue: "checked" })] });
    const plan = await builder.buildPlan(db, "sr-1");
    expect(plan.problems[0].description).toBe("NOT OPERATIONAL");
    expect(plan.problems[0].problemTypeCode).toBe("NOT_OPERATIONAL");
  });

  it("leaves problemTypeCode null (never a fuzzy guess) for an unrecognized checkbox label", async () => {
    const db = buildDb({ problem: [stagingRow({ fieldName: "OTHERS", verifiedValue: "checked" })] });
    const plan = await builder.buildPlan(db, "sr-1");
    expect(plan.problems[0].problemTypeCode).toBeNull();
  });
});

describe("ConfirmationPlanBuilderService.buildPlan — measurements (Decision 1)", () => {
  const builder = new ConfirmationPlanBuilderService(mockOf<PrismaService>({}));

  it("trusts an already-resolved suggestedMeasurementTypeCode as-is", async () => {
    const db = buildDb({ measurement: [stagingRow({ fieldName: "Low Side Pressure", verifiedValue: "65", aiUnit: "psi", suggestedMeasurementTypeCode: "LOW_SIDE_PRESSURE" })] });
    const plan = await builder.buildPlan(db, "sr-1");
    expect(plan.measurements[0].measurementTypeCode).toBe("LOW_SIDE_PRESSURE");
    expect(plan.measurements[0].measurementTypeResolution).toBe("matched");
    expect(plan.measurements[0].unit).toBe("psi");
  });

  it("falls back to OTHER_UNMAPPED, never blocking Confirm, while preserving the original fieldName", async () => {
    const db = buildDb({ measurement: [stagingRow({ fieldName: "Breaker Capacity", verifiedValue: "ISA", suggestedMeasurementTypeCode: null })] });
    const plan = await builder.buildPlan(db, "sr-1");
    expect(plan.isConfirmable).toBe(true);
    expect(plan.measurements[0].measurementTypeCode).toBe("OTHER_UNMAPPED");
    expect(plan.measurements[0].measurementTypeResolution).toBe("fallback_unmapped");
    expect(plan.measurements[0].sourceFieldName).toBe("Breaker Capacity");
    expect(plan.measurements[0].value).toBe("ISA");
  });

  it("skips a CONFIRMED_BLANK measurement — never creates an empty record", async () => {
    const db = buildDb({ measurement: [stagingRow({ fieldName: "Room Temp", reviewStatus: "CONFIRMED_BLANK", verifiedValue: null })] });
    const plan = await builder.buildPlan(db, "sr-1");
    expect(plan.measurements).toEqual([]);
    expect(plan.skipped).toContainEqual(expect.objectContaining({ category: "measurement" }));
  });

  it("resolves a raw stage string to a real stage code by exact match", async () => {
    const db = buildDb({ measurement: [stagingRow({ fieldName: "Low Side Pressure", verifiedValue: "65", suggestedMeasurementTypeCode: "LOW_SIDE_PRESSURE", stage: "before cleaning" })] });
    const plan = await builder.buildPlan(db, "sr-1");
    expect(plan.measurements[0].stageCode).toBe("BEFORE_CLEANING");
  });

  it("never invents a taxonomy code the extraction pipeline didn't already suggest — no fuzzy fieldName matching", async () => {
    // "Suction Air Temp" superficially resembles a real measurement type but was never suggested — must not be guessed.
    const db = buildDb({ measurement: [stagingRow({ fieldName: "Suction Air Temp", verifiedValue: "78", suggestedMeasurementTypeCode: null })] });
    const plan = await builder.buildPlan(db, "sr-1");
    expect(plan.measurements[0].measurementTypeCode).toBe("OTHER_UNMAPPED");
  });
});

describe("ConfirmationPlanBuilderService.buildPlan — narrative items and signoffs", () => {
  const builder = new ConfirmationPlanBuilderService(mockOf<PrismaService>({}));

  it("skips a blank narrative item", async () => {
    const db = buildDb({ narrativeItem: [stagingRow({ reviewStatus: "CONFIRMED_BLANK", verifiedValue: null })] });
    const plan = await builder.buildPlan(db, "sr-1");
    expect(plan.narrativeItems).toEqual([]);
  });

  it("resolves a recognized signoff role deterministically", async () => {
    const db = buildDb({ signoff: [stagingRow({ fieldName: "Technician Signature", verifiedValue: "John Arnold Candia" })] });
    const plan = await builder.buildPlan(db, "sr-1");
    expect(plan.signoffs[0].signoffRoleCode).toBe("TECHNICIAN");
    expect(plan.signoffs[0].signoffRoleResolution).toBe("matched");
    expect(plan.signoffs[0].signatoryName).toBe("John Arnold Candia");
    expect(plan.signoffs[0].signed).toBe(true);
  });

  it("falls back to OTHER for an unrecognized signoff role label, never fuzzy-matching", async () => {
    const db = buildDb({ signoff: [stagingRow({ fieldName: "Site Supervisor Signature", verifiedValue: "Someone" })] });
    const plan = await builder.buildPlan(db, "sr-1");
    expect(plan.signoffs[0].signoffRoleCode).toBe("OTHER");
    expect(plan.signoffs[0].signoffRoleResolution).toBe("fallback_other");
  });

  it("skips a blank signoff — never creates an empty signed record", async () => {
    const db = buildDb({ signoff: [stagingRow({ reviewStatus: "CONFIRMED_BLANK", verifiedValue: null })] });
    const plan = await builder.buildPlan(db, "sr-1");
    expect(plan.signoffs).toEqual([]);
  });
});
