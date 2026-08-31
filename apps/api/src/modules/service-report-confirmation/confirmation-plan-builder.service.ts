import { Injectable, NotFoundException } from "@nestjs/common";
import { ExtractionReviewStatus, Prisma, ServiceReportStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { STAGING_CATEGORIES, StagingCategory } from "../service-report-verification/staging-category";

/**
 * Phase 5 Step 6 (Confirm Report) — the single source of deterministic
 * mapping/validation logic, used identically by both
 * `GET .../confirm/preview` (read-only) and `POST .../confirm` (the actual
 * writer). Accepts either the ambient PrismaService or a `$transaction`
 * callback's `tx` — both expose the same model delegates this class reads
 * from, so preview and confirm can never drift from each other; the only
 * difference is which client Confirm passes in (its own transaction) and
 * that Confirm re-runs this from scratch inside that transaction rather
 * than trusting a client-supplied preview payload (approved Decision 7).
 *
 * No fuzzy/speculative taxonomy matching anywhere in this file (approved
 * Decisions 1-3): every code resolution is either (a) a value the
 * extraction/verification pipeline already deterministically produced
 * (measurement's suggestedMeasurementTypeCode), or (b) an exact,
 * case/whitespace-normalized string match against a real seeded taxonomy
 * row or a small fixed lookup table — never a substring/token/similarity
 * match. Anything that doesn't hit an exact match falls back to the
 * approved OTHER / OTHER_UNMAPPED code, never blocking Confirm and never
 * silently discarding the original text (see the provenance fields on
 * every Planned* type below, and sourceFieldName on PlannedMeasurement in
 * particular — see the schema migration comment for why that one field
 * needed a new column while the others didn't).
 */

type Db = PrismaService | Prisma.TransactionClient;

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim().length === 0;
}

function isCheckboxLiteral(value: string | null): "checked" | "unchecked" | null {
  if (value === null) return null;
  const n = value.trim().toLowerCase();
  return n === "checked" || n === "unchecked" ? n : null;
}

export interface StagingProvenance {
  category: StagingCategory;
  stagingRowId: string;
  fieldName: string;
  rowIndex: number;
}

export interface ConfirmationValidationIssue {
  code: "NOT_VERIFIED" | "ALREADY_CONFIRMED" | "UNREVIEWED_FIELDS" | "NEEDS_FOLLOW_UP";
  message: string;
}

export interface PlannedTechnician {
  technicianName: string;
  sortOrder: number;
  provenance: StagingProvenance;
}

export interface PlannedHeader {
  serviceDate: Date | null;
  timeIn: Date | null;
  timeOut: Date | null;
  reportReferenceNumber: string | null;
  contactName: string | null;
  contactPhone: string | null;
  generalNotes: string | null;
}

export interface PlannedEquipmentUnit {
  rowIndex: number;
  equipmentTypeCode: string;
  equipmentTypeResolution: "matched" | "fallback_other";
  unitTag: string | null;
  description: string;
  location: string | null;
  modelNumber: string | null;
  serialNumber: string | null;
  provenance: StagingProvenance[];
}

export interface PlannedProblem {
  rowIndex: number;
  problemTypeCode: string | null;
  description: string;
  provenance: StagingProvenance;
}

export interface PlannedMeasurement {
  equipmentRowIndex: number;
  measurementTypeCode: string;
  measurementTypeResolution: "matched" | "fallback_unmapped";
  stageCode: string | null;
  value: string;
  unit: string | null;
  sourceFieldName: string;
  provenance: StagingProvenance;
}

export interface PlannedNarrativeItem {
  equipmentRowIndex: number;
  category: string | null;
  description: string;
  provenance: StagingProvenance;
}

export interface PlannedSignoff {
  signoffRoleCode: string;
  signoffRoleResolution: "matched" | "fallback_other";
  signatoryName: string | null;
  signed: boolean;
  provenance: StagingProvenance;
}

export interface SkippedRecord {
  category: StagingCategory;
  rowIndex: number;
  reason: string;
}

export interface ConfirmationPlan {
  reportId: string;
  reportStatus: ServiceReportStatus;
  isConfirmable: boolean;
  validationIssues: ConfirmationValidationIssue[];
  header: PlannedHeader;
  technicians: PlannedTechnician[];
  equipmentUnits: PlannedEquipmentUnit[];
  problems: PlannedProblem[];
  measurements: PlannedMeasurement[];
  narrativeItems: PlannedNarrativeItem[];
  signoffs: PlannedSignoff[];
  skipped: SkippedRecord[];
  warnings: string[];
}

// ---- basic_info field-name recognition -----------------------------------
// The extraction prompt (vertex-gemini.provider.ts) never constrains
// basicInfo fieldName to a fixed vocabulary — it's whatever text the model
// reads off the header. This lookup only recognizes the wordings actually
// evidenced on real AgileWorks forms (Step 1 report). Anything not
// recognized here is never dropped — see "unrecognized basic info fields"
// handling in buildPlan, which folds it into generalNotes instead.
type HeaderTarget = "serviceDate" | "timeIn" | "timeOut" | "reportReferenceNumber" | "contactName" | "contactPhone" | "generalNotes" | "technicianName";

const BASIC_INFO_FIELD_MAP: Record<string, HeaderTarget> = {
  "work date": "serviceDate",
  "service date": "serviceDate",
  date: "serviceDate",
  "time in": "timeIn",
  "time-in": "timeIn",
  "start time": "timeIn",
  "time out": "timeOut",
  "time-out": "timeOut",
  "end time": "timeOut",
  "finish time": "timeOut",
  "report reference number": "reportReferenceNumber",
  "reference number": "reportReferenceNumber",
  "sr no.": "reportReferenceNumber",
  "sr no": "reportReferenceNumber",
  "report no.": "reportReferenceNumber",
  "report no": "reportReferenceNumber",
  "control no.": "reportReferenceNumber",
  "control no": "reportReferenceNumber",
  "contact person": "contactName",
  "contact name": "contactName",
  // Combined "name / phone" printed field (evidenced on real forms, Step 1
  // report) — kept whole in contactName rather than speculatively split on
  // punctuation, which would risk silently misassigning part of the text.
  "contact person / tel no.": "contactName",
  "contact person/tel no.": "contactName",
  "contact person / tel no": "contactName",
  "contact no.": "contactPhone",
  "contact no": "contactPhone",
  "tel no.": "contactPhone",
  "tel no": "contactPhone",
  "contact phone": "contactPhone",
  "general notes": "generalNotes",
  remarks: "generalNotes",
  notes: "generalNotes",
  "technician name": "technicianName",
  technician: "technicianName",
  technicians: "technicianName",
};

const EQUIPMENT_FIELD_MAP: Record<string, "unitTag" | "description" | "location" | "modelNumber" | "serialNumber"> = {
  "unit tag": "unitTag",
  "unit no.": "unitTag",
  "unit no": "unitTag",
  "unit number": "unitTag",
  tag: "unitTag",
  description: "description",
  "unit description": "description",
  "equipment description": "description",
  location: "location",
  "unit location": "location",
  area: "location",
  model: "modelNumber",
  "model number": "modelNumber",
  "model no.": "modelNumber",
  "model no": "modelNumber",
  "unit model": "modelNumber",
  serial: "serialNumber",
  "serial number": "serialNumber",
  "serial no.": "serialNumber",
  "serial no": "serialNumber",
};

const NARRATIVE_CATEGORY_VALUES = new Set(["WORK_DESCRIPTION", "FINDING", "RECOMMENDATION", "REMARK", "CUSTOMER_REMARKS"]);

// Fixed, deterministic — never looked up dynamically against signoff_roles,
// since the fieldName wording ("Technician Signature") is a convention of
// the printed form, not itself a taxonomy the extraction pipeline resolves
// (unlike measurement, where suggestedMeasurementTypeCode already exists).
const SIGNOFF_ROLE_FIELD_MAP: Record<string, string> = {
  "technician signature": "TECHNICIAN",
  technician: "TECHNICIAN",
  "customer signature": "CUSTOMER",
  customer: "CUSTOMER",
  "field engineer signature": "FIELD_ENGINEER",
  "field engineer": "FIELD_ENGINEER",
  "installer representative signature": "INSTALLER_REPRESENTATIVE",
  "installer representative": "INSTALLER_REPRESENTATIVE",
  "customer representative signature": "CUSTOMER_REPRESENTATIVE",
  "customer representative": "CUSTOMER_REPRESENTATIVE",
};

/**
 * Deliberately conservative: only recognizes formats actually producible by
 * "transcribe exactly as printed/handwritten" (the extraction prompt's own
 * rule 2) for a date header field — a full month name plus day and 4-digit
 * year, or an explicit numeric D/M/Y or Y-M-D form. Never guesses a
 * date from an ambiguous bare number. Returns null (never throws) on
 * anything else — the original text is preserved via generalNotes by the
 * caller, never silently dropped.
 */
function parseServiceDate(text: string): Date | null {
  const trimmed = text.trim();
  const isoOrSlash = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoOrSlash) {
    const [, y, m, d] = isoOrSlash;
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const slash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const [, m, d, yRaw] = slash;
    const year = yRaw.length === 2 ? 2000 + Number(yRaw) : Number(yRaw);
    const date = new Date(Date.UTC(year, Number(m) - 1, Number(d)));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  // "August 28, 2026" / "Aug 28, 2026" / "28 August 2026" — requires an
  // actual month NAME plus a 4-digit year, never a bare numeric guess.
  // `new Date(string)` for a non-ISO format like this is parsed as LOCAL
  // midnight (implementation-defined but consistent across V8), so its own
  // getFullYear/getMonth/getDate already give the right calendar date —
  // reconstructing via Date.UTC from those (rather than returning the
  // local-midnight instant directly) keeps this consistent with the other
  // two branches above and avoids an off-by-one-day shift under
  // .toISOString() when the process's local timezone is ahead of UTC.
  if (/[A-Za-z]{3,}/.test(trimmed) && /\d{4}/.test(trimmed)) {
    const native = new Date(trimmed);
    if (!Number.isNaN(native.getTime())) {
      return new Date(Date.UTC(native.getFullYear(), native.getMonth(), native.getDate()));
    }
  }
  return null;
}

/** Same conservative philosophy as parseServiceDate — explicit H:MM[am/pm] or 24-hour H:MM only. */
function parseTimeOfDay(text: string): Date | null {
  const match = text.trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm|AM|PM)?$/);
  if (!match) return null;
  const [, hStr, mStr, meridiemRaw] = match;
  let hour = Number(hStr);
  const minute = Number(mStr);
  if (hour > 23 || minute > 59) return null;
  const meridiem = meridiemRaw?.toLowerCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  }
  // Prisma's @db.Time reads/writes a DateTime whose date portion is
  // ignored by Postgres — 1970-01-01 is the conventional base.
  return new Date(Date.UTC(1970, 0, 1, hour, minute, 0));
}

interface RawStagingRow {
  id: string;
  rowIndex: number;
  fieldName: string;
  reviewStatus: ExtractionReviewStatus | null;
  verifiedValue: string | null;
  aiUnit?: string | null;
  stage?: string | null;
  suggestedMeasurementTypeCode?: string | null;
}

interface StagingDelegate {
  findMany(args: { where: { serviceReportId: string } }): Promise<RawStagingRow[]>;
}

@Injectable()
export class ConfirmationPlanBuilderService {
  constructor(private readonly prisma: PrismaService) {}

  private delegateFor(db: Db, category: StagingCategory): StagingDelegate {
    switch (category) {
      case "basicInfo":
        return db.extractionBasicInfo as unknown as StagingDelegate;
      case "equipmentUnit":
        return db.extractionEquipmentUnit as unknown as StagingDelegate;
      case "problem":
        return db.extractionProblem as unknown as StagingDelegate;
      case "measurement":
        return db.extractionMeasurement as unknown as StagingDelegate;
      case "narrativeItem":
        return db.extractionNarrativeItem as unknown as StagingDelegate;
      case "signoff":
        return db.extractionSignoff as unknown as StagingDelegate;
    }
  }

  async buildPlan(db: Db, serviceReportId: string): Promise<ConfirmationPlan> {
    const report = await db.serviceReport.findUnique({ where: { id: serviceReportId } });
    if (!report) {
      // Bug fix (found while implementing Step 7 — reusing this same
      // pre-check pattern for lock()): a plain Error thrown from inside a
      // service method falls through to the global exception filter as a
      // 500, not a 404. NotFoundException is the correct, pre-existing
      // convention used everywhere else in this codebase for exactly this
      // case (see e.g. findReportOrThrow in this same module's
      // service-report-confirmation.service.ts).
      throw new NotFoundException(`Service Report ${serviceReportId} not found`);
    }

    const rowsByCategory = new Map<StagingCategory, RawStagingRow[]>();
    for (const category of STAGING_CATEGORIES) {
      rowsByCategory.set(category, await this.delegateFor(db, category).findMany({ where: { serviceReportId } }));
    }

    const validationIssues: ConfirmationValidationIssue[] = [];
    if (report.status !== ServiceReportStatus.VERIFIED) {
      validationIssues.push({
        code: report.status === ServiceReportStatus.CONFIRMED || report.status === ServiceReportStatus.LOCKED ? "ALREADY_CONFIRMED" : "NOT_VERIFIED",
        message: `Service Report is ${report.status}, not VERIFIED — Confirm is not available`,
      });
    }
    let unreviewed = 0;
    let needsFollowUp = 0;
    for (const rows of rowsByCategory.values()) {
      for (const row of rows) {
        if (row.reviewStatus === null) unreviewed += 1;
        else if (row.reviewStatus === ExtractionReviewStatus.NEEDS_FOLLOW_UP) needsFollowUp += 1;
      }
    }
    if (unreviewed > 0) {
      validationIssues.push({ code: "UNREVIEWED_FIELDS", message: `${unreviewed} staging field(s) have not been reviewed` });
    }
    if (needsFollowUp > 0) {
      validationIssues.push({ code: "NEEDS_FOLLOW_UP", message: `${needsFollowUp} staging field(s) are flagged NEEDS_FOLLOW_UP` });
    }

    const warnings: string[] = [];
    const skipped: SkippedRecord[] = [];

    // ---- taxonomy lookups (exact match only — never fuzzy) ----
    const [equipmentTypes, problemTypes, measurementStages, measurementTypes] = await Promise.all([
      db.equipmentType.findMany({ where: { status: "ACTIVE" } }),
      db.problemType.findMany({ where: { status: "ACTIVE" } }),
      db.measurementStage.findMany({ where: { status: "ACTIVE" } }),
      db.measurementType.findMany({ where: { status: "ACTIVE" } }),
    ]);
    const validMeasurementTypeCodes = new Set(measurementTypes.map((t) => t.code));
    const equipmentTypeByNormalized = new Map<string, string>();
    for (const t of equipmentTypes) {
      equipmentTypeByNormalized.set(normalize(t.code), t.code);
      equipmentTypeByNormalized.set(normalize(t.label), t.code);
    }
    const problemTypeByNormalized = new Map<string, string>();
    for (const t of problemTypes) {
      problemTypeByNormalized.set(normalize(t.code), t.code);
      problemTypeByNormalized.set(normalize(t.label), t.code);
    }
    const stageByNormalized = new Map<string, string>();
    for (const s of measurementStages) {
      stageByNormalized.set(normalize(s.code), s.code);
      stageByNormalized.set(normalize(s.label), s.code);
      stageByNormalized.set(normalize(s.code.replace(/_/g, " ")), s.code);
    }

    // ---- basicInfo -> header fields + technicians (repeating) ----
    const header: PlannedHeader = {
      serviceDate: null,
      timeIn: null,
      timeOut: null,
      reportReferenceNumber: null,
      contactName: null,
      contactPhone: null,
      generalNotes: null,
    };
    const generalNotesParts: string[] = [];
    const technicians: PlannedTechnician[] = [];
    let technicianSortOrder = 0;
    for (const row of rowsByCategory.get("basicInfo")!) {
      if (isBlank(row.verifiedValue)) continue; // CONFIRMED_BLANK / never-applicable — nothing to write
      const value = row.verifiedValue!.trim();
      const target = BASIC_INFO_FIELD_MAP[normalize(row.fieldName)];
      const provenance: StagingProvenance = { category: "basicInfo", stagingRowId: row.id, fieldName: row.fieldName, rowIndex: row.rowIndex };

      if (target === "technicianName") {
        technicians.push({ technicianName: value, sortOrder: technicianSortOrder++, provenance });
        continue;
      }
      if (target === "serviceDate") {
        const parsed = parseServiceDate(value);
        if (parsed) header.serviceDate = parsed;
        else {
          warnings.push(`Basic info field "${row.fieldName}" ("${value}") could not be parsed as a date — preserved in general notes instead`);
          generalNotesParts.push(`${row.fieldName}: ${value}`);
        }
        continue;
      }
      if (target === "timeIn" || target === "timeOut") {
        const parsed = parseTimeOfDay(value);
        if (parsed) header[target] = parsed;
        else {
          warnings.push(`Basic info field "${row.fieldName}" ("${value}") could not be parsed as a time — preserved in general notes instead`);
          generalNotesParts.push(`${row.fieldName}: ${value}`);
        }
        continue;
      }
      if (target === "reportReferenceNumber" || target === "contactName" || target === "contactPhone") {
        header[target] = value;
        continue;
      }
      if (target === "generalNotes") {
        generalNotesParts.push(value);
        continue;
      }
      // Unrecognized fieldName — never dropped. Folded into general notes,
      // labeled, so the reviewer can still see exactly what it said.
      generalNotesParts.push(`${row.fieldName}: ${value}`);
    }
    header.generalNotes = generalNotesParts.length > 0 ? generalNotesParts.join("\n") : null;

    // ---- equipmentUnit -> one canonical row per rowIndex group ----
    const equipmentGroups = new Map<number, RawStagingRow[]>();
    for (const row of rowsByCategory.get("equipmentUnit")!) {
      const group = equipmentGroups.get(row.rowIndex) ?? [];
      group.push(row);
      equipmentGroups.set(row.rowIndex, group);
    }
    const equipmentUnits: PlannedEquipmentUnit[] = [];
    const equipmentRowIndexesWithCanonicalRow = new Set<number>();
    for (const [rowIndex, rows] of [...equipmentGroups.entries()].sort((a, b) => a[0] - b[0])) {
      const populated = rows.filter((r) => !isBlank(r.verifiedValue));
      if (populated.length === 0) {
        // Approved Decision 4 — an entirely blank repeating group never
        // becomes a canonical row (never an empty equipment unit record).
        skipped.push({ category: "equipmentUnit", rowIndex, reason: "every field in this equipment unit group is blank" });
        continue;
      }
      const unit: PlannedEquipmentUnit = {
        rowIndex,
        equipmentTypeCode: "OTHER",
        equipmentTypeResolution: "fallback_other",
        unitTag: null,
        description: "",
        location: null,
        modelNumber: null,
        serialNumber: null,
        provenance: [],
      };
      const descriptionParts: string[] = [];
      let typeResolved = false;
      for (const row of populated) {
        const value = row.verifiedValue!.trim();
        unit.provenance.push({ category: "equipmentUnit", stagingRowId: row.id, fieldName: row.fieldName, rowIndex: row.rowIndex });
        const target = EQUIPMENT_FIELD_MAP[normalize(row.fieldName)];
        if (target === "description") {
          descriptionParts.unshift(value); // the field explicitly called "description" leads
          continue;
        }
        if (target) {
          unit[target] = value;
          continue;
        }
        // Not a recognized column — including any wording for "equipment
        // type" (approved Decision 2: preserve the original free text).
        // Attempt one exact, non-fuzzy match against the seeded taxonomy
        // first; either way the raw text is folded into description so it
        // is never lost, matched or not.
        if (!typeResolved) {
          const matchedCode = equipmentTypeByNormalized.get(normalize(value));
          if (matchedCode) {
            unit.equipmentTypeCode = matchedCode;
            unit.equipmentTypeResolution = "matched";
            typeResolved = true;
          }
        }
        descriptionParts.push(`${row.fieldName}: ${value}`);
      }
      unit.description = descriptionParts.length > 0 ? descriptionParts.join("; ").slice(0, 255) : `Equipment unit ${rowIndex + 1}`;
      if (unit.equipmentTypeResolution === "fallback_other") {
        warnings.push(`Equipment unit (row ${rowIndex}) could not be matched to a known equipment type — using OTHER`);
      }
      equipmentUnits.push(unit);
      equipmentRowIndexesWithCanonicalRow.add(rowIndex);
    }

    // ---- problem -> one canonical row per staging row (checkbox-aware) ----
    const problems: PlannedProblem[] = [];
    for (const row of rowsByCategory.get("problem")!) {
      const checkbox = isCheckboxLiteral(row.verifiedValue);
      if (checkbox === "unchecked") {
        skipped.push({ category: "problem", rowIndex: row.rowIndex, reason: `"${row.fieldName}" checkbox was unchecked` });
        continue;
      }
      if (isBlank(row.verifiedValue)) {
        skipped.push({ category: "problem", rowIndex: row.rowIndex, reason: `"${row.fieldName}" is blank` });
        continue;
      }
      // "checked" carries no separate prose — the checkbox's own printed
      // label IS the finding. Otherwise verifiedValue is already prose.
      const description = checkbox === "checked" ? row.fieldName : row.verifiedValue!.trim();
      const problemTypeCode = problemTypeByNormalized.get(normalize(row.fieldName)) ?? null;
      problems.push({
        rowIndex: row.rowIndex,
        problemTypeCode,
        description,
        provenance: { category: "problem", stagingRowId: row.id, fieldName: row.fieldName, rowIndex: row.rowIndex },
      });
    }

    // ---- measurement -> one canonical row per staging row ----
    const measurements: PlannedMeasurement[] = [];
    for (const row of rowsByCategory.get("measurement")!) {
      if (isBlank(row.verifiedValue)) {
        skipped.push({ category: "measurement", rowIndex: row.rowIndex, reason: `"${row.fieldName}" is blank` });
        continue;
      }
      // Approved Decision 1 — trust the pipeline's own deterministic
      // suggestion as-is; never re-derive it from fieldName text here. Only
      // exact-membership re-checked (never re-matched) — a suggested code
      // could in principle have been retired from measurement_types
      // between extraction and Confirm; treat that exactly like "no
      // suggestion" rather than writing a now-invalid FK value.
      const suggested = row.suggestedMeasurementTypeCode;
      const suggestionStillValid = suggested !== null && suggested !== undefined && validMeasurementTypeCodes.has(suggested);
      let measurementTypeCode = "OTHER_UNMAPPED";
      let measurementTypeResolution: "matched" | "fallback_unmapped" = "fallback_unmapped";
      if (suggestionStillValid) {
        measurementTypeCode = suggested as string;
        measurementTypeResolution = "matched";
      } else {
        warnings.push(`Measurement "${row.fieldName}" (row ${row.rowIndex}) has no resolvable measurement type — using OTHER_UNMAPPED`);
      }
      const stageCode = row.stage ? (stageByNormalized.get(normalize(row.stage)) ?? null) : null;
      measurements.push({
        equipmentRowIndex: row.rowIndex,
        measurementTypeCode,
        measurementTypeResolution,
        stageCode,
        value: row.verifiedValue!.trim(),
        unit: row.aiUnit ?? null,
        sourceFieldName: row.fieldName,
        provenance: { category: "measurement", stagingRowId: row.id, fieldName: row.fieldName, rowIndex: row.rowIndex },
      });
    }

    // ---- narrativeItem -> one canonical row per staging row ----
    const narrativeItems: PlannedNarrativeItem[] = [];
    for (const row of rowsByCategory.get("narrativeItem")!) {
      if (isBlank(row.verifiedValue)) {
        skipped.push({ category: "narrativeItem", rowIndex: row.rowIndex, reason: `"${row.fieldName}" is blank` });
        continue;
      }
      const normalizedFieldName = row.fieldName.trim().toUpperCase().replace(/\s+/g, "_");
      narrativeItems.push({
        equipmentRowIndex: row.rowIndex,
        category: NARRATIVE_CATEGORY_VALUES.has(normalizedFieldName) ? normalizedFieldName : null,
        description: row.verifiedValue!.trim(),
        provenance: { category: "narrativeItem", stagingRowId: row.id, fieldName: row.fieldName, rowIndex: row.rowIndex },
      });
    }

    // ---- signoff -> one canonical row per staging row ----
    const signoffs: PlannedSignoff[] = [];
    for (const row of rowsByCategory.get("signoff")!) {
      if (isBlank(row.verifiedValue)) {
        skipped.push({ category: "signoff", rowIndex: row.rowIndex, reason: `"${row.fieldName}" is blank` });
        continue;
      }
      const checkbox = isCheckboxLiteral(row.verifiedValue);
      const matchedRole = SIGNOFF_ROLE_FIELD_MAP[normalize(row.fieldName)];
      const signoffRoleCode = matchedRole ?? "OTHER";
      if (!matchedRole) {
        warnings.push(`Signoff "${row.fieldName}" (row ${row.rowIndex}) could not be matched to a known role — using OTHER`);
      }
      signoffs.push({
        signoffRoleCode,
        signoffRoleResolution: matchedRole ? "matched" : "fallback_other",
        signatoryName: checkbox ? null : row.verifiedValue!.trim(),
        signed: checkbox === "unchecked" ? false : true,
        provenance: { category: "signoff", stagingRowId: row.id, fieldName: row.fieldName, rowIndex: row.rowIndex },
      });
    }

    // Any measurement/narrative row referencing an equipment rowIndex that
    // was itself skipped as entirely blank (Decision 4) simply gets no
    // equipmentUnitId at Confirm time (left null) rather than being
    // dropped — a real reading is never discarded just because its
    // equipment-identifying fields happened to be blank.
    for (const m of measurements) {
      if (!equipmentRowIndexesWithCanonicalRow.has(m.equipmentRowIndex)) {
        warnings.push(`Measurement "${m.sourceFieldName}" (row ${m.equipmentRowIndex}) has no matching equipment unit — will not be linked to one`);
      }
    }

    return {
      reportId: serviceReportId,
      reportStatus: report.status,
      isConfirmable: validationIssues.length === 0,
      validationIssues,
      header,
      technicians,
      equipmentUnits,
      problems,
      measurements,
      narrativeItems,
      signoffs,
      skipped,
      warnings,
    };
  }
}
