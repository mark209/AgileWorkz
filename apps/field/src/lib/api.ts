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

export interface ServiceReportType {
  code: string;
  label: string;
  sortOrder: number;
}

export function listServiceReportTypes(accessToken: string) {
  return apiRequest<ServiceReportType[]>("/service-reports/types", { accessToken });
}

export interface UploadedServiceReport {
  id: string;
  serviceReportNumber: string;
  status: string;
}

export function uploadServiceReport(
  accessToken: string,
  customerId: string,
  input: { siteId: string; workOrderId: string; reportTypeCode: string; file: File; idempotencyKey?: string },
) {
  const formData = new FormData();
  formData.append("siteId", input.siteId);
  formData.append("workOrderId", input.workOrderId);
  formData.append("reportTypeCode", input.reportTypeCode);
  formData.append("file", input.file);
  return apiUpload<UploadedServiceReport>(`/customers/${customerId}/service-reports`, formData, accessToken, input.idempotencyKey);
}
