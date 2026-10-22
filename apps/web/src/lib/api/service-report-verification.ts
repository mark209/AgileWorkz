import { apiRequest } from "../api-client";

// Mirrors apps/api's Phase 5 Step 5 types exactly (ExtractionConfidence,
// ExtractionReviewStatus from @prisma/client; StagedFieldView/
// VerificationView/BulkConfirmPreview from
// service-report-verification.service.ts) — kept as a plain parallel
// definition here since the web app doesn't share a package with the
// Prisma-generated types.
export type ExtractionConfidence = "HIGH" | "MEDIUM" | "LOW" | "UNREADABLE";
export type ExtractionReviewStatus = "CONFIRMED" | "CORRECTED" | "CONFIRMED_BLANK" | "NEEDS_FOLLOW_UP";
export type StagingCategory = "basicInfo" | "equipmentUnit" | "problem" | "measurement" | "narrativeItem" | "signoff";

export const STAGING_CATEGORIES: StagingCategory[] = [
  "basicInfo",
  "equipmentUnit",
  "problem",
  "measurement",
  "narrativeItem",
  "signoff",
];

export const STAGING_CATEGORY_LABELS: Record<StagingCategory, string> = {
  basicInfo: "Basic Information",
  equipmentUnit: "Equipment Units",
  problem: "Problems / Checklist",
  measurement: "Measurements / Technical Data",
  narrativeItem: "Narrative / Findings / Recommendations",
  signoff: "Signoffs",
};

export interface StagedFieldView {
  id: string;
  category: StagingCategory;
  rowIndex: number;
  fieldName: string;
  aiValue: string | null;
  aiUnit: string | null;
  aiConfidence: ExtractionConfidence | null;
  suggestedMeasurementTypeCode: string | null;
  stage: string | null;
  requiresHumanVerification: boolean;
  reviewStatus: ExtractionReviewStatus | null;
  verifiedValue: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
}

export interface VerificationView {
  report: {
    id: string;
    status: string;
    verificationBasis: "DOCUMENT_ONLY" | "EXTRACTED_FIELDS" | null;
    reportTypeCode: string;
    documentFileName: string;
    documentMimeType: string;
    uploadedBy: string | null;
    uploadedAt: string;
    verifiedBy: string | null;
    verifiedAt: string | null;
  };
  documentUrl: string;
  fields: Record<StagingCategory, StagedFieldView[]>;
}

export interface BulkConfirmPreview {
  eligibleCount: number;
  eligibleFields: Array<{ category: StagingCategory; id: string; fieldName: string; aiValue: string | null }>;
}

export interface ServiceReportListItem {
  id: string;
  serviceReportNumber: string;
  status: string;
  reportTypeCode: string;
  uploadedAt: string;
}

export function listServiceReports(accessToken: string, status?: string) {
  return apiRequest<ServiceReportListItem[]>(`/service-reports${status ? `?status=${encodeURIComponent(status)}` : ""}`, {
    accessToken,
  });
}

export function getServiceReportVerification(accessToken: string, reportId: string) {
  return apiRequest<VerificationView>(`/service-reports/${reportId}/verification`, { accessToken });
}

export function submitFieldReview(
  accessToken: string,
  reportId: string,
  category: StagingCategory,
  rowId: string,
  body: { reviewStatus: ExtractionReviewStatus; verifiedValue?: string },
) {
  return apiRequest<StagedFieldView>(`/service-reports/${reportId}/verification/${category}/${rowId}`, {
    method: "PATCH",
    body,
    accessToken,
  });
}

export function previewBulkConfirm(accessToken: string, reportId: string) {
  return apiRequest<BulkConfirmPreview>(`/service-reports/${reportId}/verification/bulk-confirm/preview`, { accessToken });
}

export function bulkConfirm(accessToken: string, reportId: string) {
  return apiRequest<{ confirmedCount: number; remainingAttentionCount: number }>(
    `/service-reports/${reportId}/verification/bulk-confirm`,
    { method: "POST", accessToken },
  );
}

export function completeVerification(accessToken: string, reportId: string) {
  return apiRequest<{ id: string; status: string }>(`/service-reports/${reportId}/verification/complete`, {
    method: "POST",
    accessToken,
  });
}

export function approveServiceReportDocument(accessToken: string, reportId: string) {
  return apiRequest<{ id: string; status: string }>(`/service-reports/${reportId}/verification/document-approve`, {
    method: "POST",
    body: { documentReviewed: true },
    accessToken,
  });
}
