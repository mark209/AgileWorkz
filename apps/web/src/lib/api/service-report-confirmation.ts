import { apiRequest } from "../api-client";

// Mirrors apps/api's Phase 5 Step 6 types (ConfirmationPlanBuilderService,
// ServiceReportConfirmationService) — a plain parallel definition, same
// convention as service-report-verification.ts, since the web app doesn't
// share a package with the Prisma-generated/backend types.

export interface StagingProvenance {
  category: string;
  stagingRowId: string;
  fieldName: string;
  rowIndex: number;
}

export interface ConfirmationValidationIssue {
  code: "NOT_VERIFIED" | "ALREADY_CONFIRMED" | "UNREVIEWED_FIELDS" | "NEEDS_FOLLOW_UP";
  message: string;
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
}

export interface PlannedProblem {
  rowIndex: number;
  problemTypeCode: string | null;
  description: string;
}

export interface PlannedMeasurement {
  equipmentRowIndex: number;
  measurementTypeCode: string;
  measurementTypeResolution: "matched" | "fallback_unmapped";
  stageCode: string | null;
  value: string;
  unit: string | null;
  sourceFieldName: string;
}

export interface PlannedNarrativeItem {
  equipmentRowIndex: number;
  category: string | null;
  description: string;
}

export interface PlannedSignoff {
  signoffRoleCode: string;
  signoffRoleResolution: "matched" | "fallback_other";
  signatoryName: string | null;
  signed: boolean;
}

export interface SkippedRecord {
  category: string;
  rowIndex: number;
  reason: string;
}

export interface ConfirmationPlan {
  reportId: string;
  reportStatus: string;
  isConfirmable: boolean;
  validationIssues: ConfirmationValidationIssue[];
  header: {
    serviceDate: string | null;
    timeIn: string | null;
    timeOut: string | null;
    reportReferenceNumber: string | null;
    contactName: string | null;
    contactPhone: string | null;
    generalNotes: string | null;
  };
  technicians: Array<{ technicianName: string; sortOrder: number }>;
  equipmentUnits: PlannedEquipmentUnit[];
  problems: PlannedProblem[];
  measurements: PlannedMeasurement[];
  narrativeItems: PlannedNarrativeItem[];
  signoffs: PlannedSignoff[];
  skipped: SkippedRecord[];
  warnings: string[];
}

export interface ConfirmationResult {
  report: { id: string; status: string; confirmedBy: string | null; confirmedAt: string | null };
  createdCounts: {
    technicians: number;
    equipmentUnits: number;
    problems: number;
    measurements: number;
    narrativeItems: number;
    signoffs: number;
  };
  skippedCount: number;
  warnings: string[];
}

export interface CanonicalServiceReportView {
  report: {
    id: string;
    status: string;
    serviceReportNumber: string;
    serviceDate: string | null;
    timeIn: string | null;
    timeOut: string | null;
    reportReferenceNumber: string | null;
    contactName: string | null;
    contactPhone: string | null;
    generalNotes: string | null;
    confirmedBy: string | null;
    confirmedAt: string | null;
  };
  technicians: Array<{ id: string; technicianName: string }>;
  equipmentUnits: Array<{
    id: string;
    equipmentTypeCode: string;
    unitTag: string | null;
    description: string;
    location: string | null;
    modelNumber: string | null;
    serialNumber: string | null;
  }>;
  problems: Array<{ id: string; problemTypeCode: string | null; description: string; equipmentUnitId: string | null }>;
  measurements: Array<{
    id: string;
    measurementTypeCode: string;
    stageCode: string | null;
    value: string;
    unit: string | null;
    sourceFieldName: string | null;
    equipmentUnitId: string | null;
  }>;
  narrativeItems: Array<{ id: string; category: string | null; description: string; equipmentUnitId: string | null }>;
  signoffs: Array<{ id: string; signoffRoleCode: string; signatoryName: string | null; signed: boolean }>;
}

export function previewConfirm(accessToken: string, reportId: string) {
  return apiRequest<ConfirmationPlan>(`/service-reports/${reportId}/confirm/preview`, { accessToken });
}

export function confirmServiceReport(accessToken: string, reportId: string) {
  return apiRequest<ConfirmationResult>(`/service-reports/${reportId}/confirm`, { method: "POST", accessToken });
}

export function getCanonicalServiceReport(accessToken: string, reportId: string) {
  return apiRequest<CanonicalServiceReportView>(`/service-reports/${reportId}/canonical`, { accessToken });
}

// Phase 5 Step 7 — Lock. CONFIRMED -> LOCKED only, forward-only, no
// reason/note payload (approved design) — the confirmation dialog is the
// entire client-side interaction; this call carries no body.
export function lockServiceReport(accessToken: string, reportId: string) {
  return apiRequest<{ id: string; status: string; lockedBy: string | null; lockedAt: string | null }>(
    `/service-reports/${reportId}/lock`,
    { method: "POST", accessToken },
  );
}
