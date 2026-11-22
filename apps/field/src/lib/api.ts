import { apiRequest, apiUpload } from "./api-client";
import type { RegistrationRequestInput, RegistrationResponse, RequestableDesignation } from "@agileworks/shared-types";

export function listRequestableDesignations() {
  return apiRequest<RequestableDesignation[]>("/auth/requestable-designations");
}

export function submitRegistration(body: RegistrationRequestInput) {
  return apiRequest<RegistrationResponse>("/auth/register", { method: "POST", body });
}

/**
 * Phase 4 Operations Frontend — apps/field's first real API surface beyond
 * auth. Deliberately thin, typed wrappers only (same shape as apps/web's
 * src/lib/api), scoped to exactly what a Technician's screens need: their
 * own jobs (GET /work-orders/mine), one job's detail (GET /work-orders/:id,
 * resolved server-side via getForActor's read_own branch), starting a job
 * (PATCH /work-orders/:id/start, work_orders.start_own), and uploading a
 * Service Report against it — handed entirely into Phase 5's existing
 * upload/OCR/verification pipeline via POST /customers/:id/service-reports;
 * nothing about that pipeline is duplicated or re-implemented here.
 */

export type WorkOrderStatus = "DRAFT" | "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CLOSED" | "CANCELLED";
export type WorkOrderType = "FROM_QUOTATION" | "STANDALONE";

export interface WorkOrderAssignment {
  id: string;
  technicianId: string;
  assignedAt: string;
  technician: { id: string; fullName: string };
}

export interface WorkOrder {
  tasks?: Array<{ id: string; description: string; method?: string | null; indications?: string | null; status: string }>;
  id: string;
  workOrderNumber: string;
  customerId: string;
  siteId: string;
  workOrderType: WorkOrderType;
  standaloneReason: string | null;
  standaloneReasonType: string | null;
  status: WorkOrderStatus;
  scheduledDate: string | null;
  description: string | null;
  startedAt: string | null;
  fieldCompletedAt?: string | null;
  completedAt: string | null;
  customer: { id: string; name: string };
  site: { id: string; label: string };
  assignments: WorkOrderAssignment[];
}

export function listMyWorkOrders(accessToken: string) {
  return apiRequest<WorkOrder[]>("/work-orders/mine", { accessToken });
}

export function getWorkOrder(accessToken: string, id: string) {
  return apiRequest<WorkOrder>(`/work-orders/${id}`, { accessToken });
}

export function startWorkOrder(accessToken: string, id: string) {
  return apiRequest<WorkOrder>(`/work-orders/${id}/start`, { method: "PATCH", accessToken });
}

export function completeFieldWorkOrder(accessToken: string, id: string) {
  return apiRequest<Pick<WorkOrder, "id" | "status" | "fieldCompletedAt">>(`/work-orders/${id}/field-complete`, { method: "PATCH", accessToken });
}

export interface ServiceReportType {
  code: string;
  label: string;
  sortOrder: number;
}

export function listServiceReportTypes(accessToken: string) {
  return apiRequest<ServiceReportType[]>("/service-reports/types", { accessToken });
}

export interface DirectReportTarget {
  id: string;
  name: string;
  sites: Array<{ id: string; label: string }>;
}

export function searchDirectReportTargets(accessToken: string, search: string) {
  return apiRequest<DirectReportTarget[]>(`/service-reports/direct-targets?search=${encodeURIComponent(search)}`, { accessToken });
}

export interface MyServiceReport {
  reportTypeOther?: string | null;
  id: string;
  documentFileName?: string | null;
  serviceReportNumber: string;
  reportTypeCode: string;
  status: string;
  uploadedAt: string;
  workOrderId: string | null;
}

export function listMyServiceReports(accessToken: string) {
  return apiRequest<MyServiceReport[]>("/service-reports/mine", { accessToken });
}

export interface UploadedServiceReport {
  id: string;
  serviceReportNumber: string;
  status: string;
}

export function uploadServiceReport(
  accessToken: string,
  customerId: string,
  input: { siteId: string; workOrderId: string; reportTypeCode: string; reportTypeOther?: string; file: File; idempotencyKey?: string },
) {
  const formData = new FormData();
  formData.append("siteId", input.siteId);
  formData.append("workOrderId", input.workOrderId);
  formData.append("reportTypeCode", input.reportTypeCode);
  if (input.reportTypeOther) formData.append("reportTypeOther", input.reportTypeOther);
  formData.append("file", input.file);
  return apiUpload<UploadedServiceReport>(`/customers/${customerId}/service-reports`, formData, accessToken, input.idempotencyKey);
}

export function uploadDirectServiceReport(
  accessToken: string,
  customerId: string,
  input: { siteId: string; reportTypeCode: string; reportTypeOther?: string; sourceType: string; file: File; idempotencyKey: string },
) {
  const formData = new FormData();
  formData.append("siteId", input.siteId);
  formData.append("reportTypeCode", input.reportTypeCode);
  if (input.reportTypeOther) formData.append("reportTypeOther", input.reportTypeOther);
  formData.append("sourceType", input.sourceType);
  formData.append("file", input.file);
  return apiUpload<UploadedServiceReport>(`/customers/${customerId}/service-reports`, formData, accessToken, input.idempotencyKey);
}
