import { apiPdf, apiRequest, uploadFileWithProgress } from "../api-client";
import type { ServiceReportListItem } from "./service-report-verification";
import type {
  Asset,
  AssetStatus,
  AuditLogEntry,
  CapacityUnit,
  Contact,
  Customer,
  CustomerDecision,
  CustomerDocument,
  CustomerStatus,
  DocumentRelatedType,
  EquipmentSystem,
  EquipmentSystemType,
  EquipmentType,
  Inquiry,
  InquirySource,
  InquiryType,
  MaintenanceBillingFrequency,
  MaintenanceFrequency,
  Quotation,
  QuotationLineItem,
  QuotationMaintenanceDetails,
  QuotationRevision,
  QuotationSection,
  QuotationTermTemplate,
  QuotationTestingCommissioningItem,
  QuotationType,
  Site,
  StandaloneReasonType,
  TaxTreatment,
  TechnicianOption,
  Trade,
  WorkOrder,
  WorkOrderAssignment,
} from "./types";

export * from "./types";

// --- Customers ---------------------------------------------------------

export function listCustomers(accessToken: string) {
  return apiRequest<Customer[]>("/customers", { accessToken });
}
export function getCustomer(accessToken: string, id: string) {
  return apiRequest<Customer>(`/customers/${id}`, { accessToken });
}
export function createCustomer(
  accessToken: string,
  body: { name: string; customerType: string; billingAddress: string; phone?: string; email?: string },
) {
  return apiRequest<Customer>("/customers", { method: "POST", body, accessToken });
}
export function updateCustomerStatus(accessToken: string, id: string, status: CustomerStatus) {
  return apiRequest<Customer>(`/customers/${id}/status`, { method: "PATCH", body: { status }, accessToken });
}
export function updateCustomer(accessToken: string, id: string, body: { name: string; billingAddress: string; phone?: string; email?: string }) {
  return apiRequest<Customer>(`/customers/${id}`, { method: "PATCH", body, accessToken });
}
export function listContactsForCustomer(accessToken: string, customerId: string) {
  return apiRequest<Contact[]>(`/customers/${customerId}/contacts`, { accessToken });
}
export function createContact(accessToken: string, customerId: string, body: { fullName: string; phone?: string; email?: string }) {
  return apiRequest<Contact>(`/customers/${customerId}/contacts`, { method: "POST", body, accessToken });
}
export function updateContact(accessToken: string, id: string, body: { fullName: string; phone?: string; email?: string }) {
  return apiRequest<Contact>(`/contacts/${id}`, { method: "PATCH", body, accessToken });
}
export function listSitesForCustomer(accessToken: string, customerId: string) {
  return apiRequest<Site[]>(`/customers/${customerId}/sites`, { accessToken });
}
export function createSite(accessToken: string, customerId: string, body: { label: string; addressLine: string }) {
  return apiRequest<Site>(`/customers/${customerId}/sites`, { method: "POST", body, accessToken });
}
export function updateSite(accessToken: string, id: string, body: { label: string; addressLine: string }) {
  return apiRequest<Site>(`/sites/${id}`, { method: "PATCH", body, accessToken });
}
export function listServiceReportTypes(accessToken: string) {
  return apiRequest<Array<{ code: string; label: string }>>("/service-reports/types", { accessToken });
}
export function uploadCustomerServiceReport(accessToken: string, customerId: string, input: {
  siteId: string; reportTypeCode: string; sourceType: string; file: File; idempotencyKey: string;
}) {
  const form = new FormData();
  form.append("siteId", input.siteId);
  form.append("reportTypeCode", input.reportTypeCode);
  form.append("sourceType", input.sourceType);
  form.append("file", input.file);
  return uploadFileWithProgress<{ id: string; serviceReportNumber: string }>(
    `/customers/${customerId}/service-reports`, accessToken, form, undefined, input.idempotencyKey,
  );
}
export function listServiceReportsForCustomer(accessToken: string, customerId: string) {
  return apiRequest<ServiceReportListItem[]>(`/customers/${customerId}/service-reports`, { accessToken });
}

// --- Sites ---------------------------------------------------------------

export function getSite(accessToken: string, id: string) {
  return apiRequest<Site>(`/sites/${id}`, { accessToken });
}
export function listEquipmentSystemsForSite(accessToken: string, siteId: string) {
  return apiRequest<EquipmentSystem[]>(`/sites/${siteId}/equipment-systems`, { accessToken });
}
export function listAssetsForSite(accessToken: string, siteId: string) {
  return apiRequest<Asset[]>(`/sites/${siteId}/assets`, { accessToken });
}

// --- Equipment -------------------------------------------------------------

export function getAsset(accessToken: string, id: string) {
  return apiRequest<Asset>(`/assets/${id}`, { accessToken });
}
export function listServiceHistoryForAsset(accessToken: string, id: string) {
  return apiRequest<Array<{ id: string; serviceReportNumber: string; status: string; serviceDate: string | null; uploadedAt: string }>>(
    `/assets/${id}/service-reports`, { accessToken },
  );
}
export function updateAssetStatus(accessToken: string, id: string, status: AssetStatus) {
  return apiRequest<Asset>(`/assets/${id}/status`, { method: "PATCH", body: { status }, accessToken });
}
export function getEquipmentSystem(accessToken: string, id: string) {
  return apiRequest<EquipmentSystem>(`/equipment-systems/${id}`, { accessToken });
}

// --- Reference data --------------------------------------------------------

export function listEquipmentTypes(accessToken: string) {
  return apiRequest<EquipmentType[]>("/equipment-types", { accessToken });
}
export function listEquipmentSystemTypes(accessToken: string) {
  return apiRequest<EquipmentSystemType[]>("/equipment-system-types", { accessToken });
}
export function listCapacityUnits(accessToken: string) {
  return apiRequest<CapacityUnit[]>("/capacity-units", { accessToken });
}

// --- Documents ---------------------------------------------------------------

export function listDocuments(accessToken: string, relatedType: DocumentRelatedType, relatedId: string) {
  return apiRequest<CustomerDocument[]>(
    `/documents?relatedType=${encodeURIComponent(relatedType)}&relatedId=${encodeURIComponent(relatedId)}`,
    { accessToken },
  );
}
export function getDocumentSignedUrl(accessToken: string, id: string) {
  return apiRequest<{ url: string }>(`/documents/${id}/signed-url`, { accessToken });
}

// --- Phase 3 — Inquiries (Step 8) ---------------------------------------

export function listInquiriesForCustomer(accessToken: string, customerId: string) {
  return apiRequest<Inquiry[]>(`/customers/${customerId}/inquiries`, { accessToken });
}
export function getInquiry(accessToken: string, id: string) {
  return apiRequest<Inquiry>(`/inquiries/${id}`, { accessToken });
}
export interface InquiryFormInput {
  subject: string;
  description?: string;
  siteId?: string;
  contactId?: string;
  sourceCode?: string;
  tradeCode?: string;
  inquiryTypeCode?: string;
  customerReferenceNo?: string;
  preferredServiceDate?: string;
}
export function createInquiry(accessToken: string, customerId: string, body: InquiryFormInput) {
  return apiRequest<Inquiry>(`/customers/${customerId}/inquiries`, { method: "POST", body, accessToken });
}
export function updateInquiry(accessToken: string, id: string, body: Partial<InquiryFormInput>) {
  return apiRequest<Inquiry>(`/inquiries/${id}`, { method: "PATCH", body, accessToken });
}
export function closeInquiry(accessToken: string, id: string) {
  return apiRequest<Inquiry>(`/inquiries/${id}/close`, { method: "PATCH", accessToken });
}
export interface ConvertInquiryInput {
  siteId: string;
  quotationType: QuotationType;
  primaryTradeCode?: string;
  customerReferenceNo?: string;
  scopeOfWork?: string;
  defaultTaxTreatment?: TaxTreatment;
  paymentTerms?: string;
  warranty?: string;
  leadTime?: string;
  notes?: string;
  exclusions?: string;
  validUntil?: string;
}
// Delegates entirely to the existing backend conversion endpoint (atomic
// OPEN -> CONVERTED flip + Quotation/Revision 0 creation) — no conversion
// logic is reimplemented here.
export function convertInquiryToQuotation(accessToken: string, inquiryId: string, body: ConvertInquiryInput) {
  return apiRequest<Quotation>(`/inquiries/${inquiryId}/quotations`, { method: "POST", body, accessToken });
}

// --- Phase 3 — Quotations & Revisions (Step 8) --------------------------

export function listQuotationsForCustomer(accessToken: string, customerId: string) {
  return apiRequest<Quotation[]>(`/customers/${customerId}/quotations`, { accessToken });
}
export interface CreateQuotationInput {
  siteId: string;
  quotationType: QuotationType;
  primaryTradeCode: string;
  customerReferenceNo?: string;
  scopeOfWork?: string;
  defaultTaxTreatment?: TaxTreatment;
  paymentTerms?: string;
  warranty?: string;
  leadTime?: string;
  notes?: string;
  exclusions?: string;
  validUntil?: string;
}
export function createQuotation(accessToken: string, customerId: string, body: CreateQuotationInput) {
  return apiRequest<Quotation>(`/customers/${customerId}/quotations`, { method: "POST", body, accessToken });
}
export function getQuotation(accessToken: string, id: string) {
  return apiRequest<Quotation>(`/quotations/${id}`, { accessToken });
}
export function listQuotationRevisions(accessToken: string, quotationId: string) {
  return apiRequest<QuotationRevision[]>(`/quotations/${quotationId}/revisions`, { accessToken });
}
export function getQuotationRevision(accessToken: string, quotationId: string, revisionId: string) {
  return apiRequest<QuotationRevision>(`/quotations/${quotationId}/revisions/${revisionId}`, { accessToken });
}
export function getQuotationPdf(accessToken: string, quotationId: string, revisionId: string) {
  return apiPdf(`${revisionUrl(quotationId, revisionId)}/pdf`, accessToken);
}
// Full copy-forward of the current revision — the backend refuses this when
// the current revision is ACCEPTED (C6); the UI must not imply it's ever
// possible from that state.
export function createNextRevision(accessToken: string, quotationId: string) {
  return apiRequest<QuotationRevision>(`/quotations/${quotationId}/revisions`, { method: "POST", accessToken });
}
export interface UpdateRevisionContentInput {
  scopeOfWork?: string;
  paymentTerms?: string;
  warranty?: string;
  leadTime?: string;
  notes?: string;
  exclusions?: string;
  termsAndConditions?: string;
  validUntil?: string;
  defaultTaxTreatment?: TaxTreatment;
  discountPercent?: number;
  discountAmount?: number;
}
// DRAFT-only server-side (assertRevisionEditable); the UI must disable this
// form once the revision is non-DRAFT, matching that same rule.
export function updateRevisionContent(
  accessToken: string,
  quotationId: string,
  revisionId: string,
  body: UpdateRevisionContentInput,
) {
  return apiRequest<QuotationRevision>(`/quotations/${quotationId}/revisions/${revisionId}`, {
    method: "PATCH",
    body,
    accessToken,
  });
}

// --- Phase 3 — Lifecycle transitions (Step 7 endpoints, Step 8 UI) -------

const revisionUrl = (quotationId: string, revisionId: string) => `/quotations/${quotationId}/revisions/${revisionId}`;

export function submitRevision(accessToken: string, quotationId: string, revisionId: string) {
  return apiRequest<QuotationRevision>(`${revisionUrl(quotationId, revisionId)}/submit`, {
    method: "PATCH",
    accessToken,
  });
}
export function approveRevision(accessToken: string, quotationId: string, revisionId: string) {
  return apiRequest<QuotationRevision>(`${revisionUrl(quotationId, revisionId)}/approve`, {
    method: "PATCH",
    accessToken,
  });
}
export function rejectRevision(accessToken: string, quotationId: string, revisionId: string, reason: string) {
  return apiRequest<QuotationRevision>(`${revisionUrl(quotationId, revisionId)}/reject`, {
    method: "PATCH",
    body: { reason },
    accessToken,
  });
}
export function markRevisionSent(accessToken: string, quotationId: string, revisionId: string) {
  return apiRequest<QuotationRevision>(`${revisionUrl(quotationId, revisionId)}/send`, {
    method: "PATCH",
    accessToken,
  });
}
export function recordRevisionDecision(
  accessToken: string,
  quotationId: string,
  revisionId: string,
  decision: CustomerDecision,
  reason?: string,
) {
  return apiRequest<QuotationRevision>(`${revisionUrl(quotationId, revisionId)}/decision`, {
    method: "PATCH",
    body: { decision, reason: reason || undefined },
    accessToken,
  });
}
export function expireRevision(accessToken: string, quotationId: string, revisionId: string, reason: string) {
  return apiRequest<QuotationRevision>(`${revisionUrl(quotationId, revisionId)}/expire`, {
    method: "PATCH",
    body: { reason },
    accessToken,
  });
}

// --- Phase 3 — Sections (Step 8) ----------------------------------------

const sectionsUrl = (quotationId: string, revisionId: string) => `${revisionUrl(quotationId, revisionId)}/sections`;

export function listSections(accessToken: string, quotationId: string, revisionId: string) {
  return apiRequest<QuotationSection[]>(sectionsUrl(quotationId, revisionId), { accessToken });
}
export function createSection(
  accessToken: string,
  quotationId: string,
  revisionId: string,
  body: { name: string; tradeCode?: string; sortOrder?: number },
) {
  return apiRequest<QuotationSection>(sectionsUrl(quotationId, revisionId), { method: "POST", body, accessToken });
}
export function updateSection(
  accessToken: string,
  quotationId: string,
  revisionId: string,
  sectionId: string,
  body: { name?: string; tradeCode?: string | null; sortOrder?: number },
) {
  return apiRequest<QuotationSection>(`${sectionsUrl(quotationId, revisionId)}/${sectionId}`, {
    method: "PATCH",
    body,
    accessToken,
  });
}
export function deleteSection(accessToken: string, quotationId: string, revisionId: string, sectionId: string) {
  return apiRequest<{ success: boolean }>(`${sectionsUrl(quotationId, revisionId)}/${sectionId}`, {
    method: "DELETE",
    accessToken,
  });
}
// Whole-list reorder — the server assigns sort_order 0,10,20... by array
// position (same increment convention as every seeded reference table).
export function reorderSections(accessToken: string, quotationId: string, revisionId: string, sectionIds: string[]) {
  return apiRequest<QuotationSection[]>(`${sectionsUrl(quotationId, revisionId)}/reorder`, {
    method: "PATCH",
    body: { sectionIds },
    accessToken,
  });
}

// --- Phase 3 — Line items (Step 8) ---------------------------------------

const lineItemsUrl = (quotationId: string, revisionId: string) => `${revisionUrl(quotationId, revisionId)}/line-items`;

export interface LineItemFormInput {
  description: string;
  specification?: string;
  brand?: string;
  model?: string;
  quantity: number;
  unit: string;
  unitCostExpense?: number | null;
  markupPercent?: number | null;
  unitPriceBeforeVat?: number;
  taxTreatment?: TaxTreatment;
  materialAmount?: number | null;
  laborAmount?: number | null;
  sectionId?: string | null;
  assetId?: string | null;
  sortOrder?: number;
}
export function listLineItems(accessToken: string, quotationId: string, revisionId: string) {
  return apiRequest<QuotationLineItem[]>(lineItemsUrl(quotationId, revisionId), { accessToken });
}
// unitPrice/lineAmount/every VAT-and-discount-derived field is 100%
// server-computed (§06a) — never sent from here, never trusted from a
// response used for anything but display (D7).
export function createLineItem(accessToken: string, quotationId: string, revisionId: string, body: LineItemFormInput) {
  return apiRequest<QuotationLineItem>(lineItemsUrl(quotationId, revisionId), { method: "POST", body, accessToken });
}
export function updateLineItem(
  accessToken: string,
  quotationId: string,
  revisionId: string,
  lineItemId: string,
  body: Partial<LineItemFormInput>,
) {
  return apiRequest<QuotationLineItem>(`${lineItemsUrl(quotationId, revisionId)}/${lineItemId}`, {
    method: "PATCH",
    body,
    accessToken,
  });
}
export function deleteLineItem(accessToken: string, quotationId: string, revisionId: string, lineItemId: string) {
  return apiRequest<{ success: boolean }>(`${lineItemsUrl(quotationId, revisionId)}/${lineItemId}`, {
    method: "DELETE",
    accessToken,
  });
}

// --- Phase 3 — Maintenance details (Step 8) -------------------------------

const maintenanceDetailsUrl = (quotationId: string, revisionId: string) =>
  `${revisionUrl(quotationId, revisionId)}/maintenance-details`;

// Returns null (200) when no row exists yet — never 404. An empty form, not
// an error state.
export function getMaintenanceDetails(accessToken: string, quotationId: string, revisionId: string) {
  return apiRequest<QuotationMaintenanceDetails | null>(maintenanceDetailsUrl(quotationId, revisionId), {
    accessToken,
  });
}
export function upsertMaintenanceDetails(
  accessToken: string,
  quotationId: string,
  revisionId: string,
  body: {
    contractPeriodMonths: number;
    frequency: MaintenanceFrequency;
    scheduledVisits: number;
    billingFrequency: MaintenanceBillingFrequency;
  },
) {
  return apiRequest<QuotationMaintenanceDetails>(maintenanceDetailsUrl(quotationId, revisionId), {
    method: "PATCH",
    body,
    accessToken,
  });
}

// --- Phase 3 — Testing & Commissioning items (Step 8) ---------------------

const testingItemsUrl = (quotationId: string, revisionId: string) =>
  `${revisionUrl(quotationId, revisionId)}/testing-commissioning-items`;

export function listTestingItems(accessToken: string, quotationId: string, revisionId: string) {
  return apiRequest<QuotationTestingCommissioningItem[]>(testingItemsUrl(quotationId, revisionId), { accessToken });
}
export function createTestingItem(
  accessToken: string,
  quotationId: string,
  revisionId: string,
  body: { description: string; included?: boolean; sortOrder?: number },
) {
  return apiRequest<QuotationTestingCommissioningItem>(testingItemsUrl(quotationId, revisionId), {
    method: "POST",
    body,
    accessToken,
  });
}
export function updateTestingItem(
  accessToken: string,
  quotationId: string,
  revisionId: string,
  itemId: string,
  body: { description?: string; included?: boolean; sortOrder?: number },
) {
  return apiRequest<QuotationTestingCommissioningItem>(`${testingItemsUrl(quotationId, revisionId)}/${itemId}`, {
    method: "PATCH",
    body,
    accessToken,
  });
}
export function deleteTestingItem(accessToken: string, quotationId: string, revisionId: string, itemId: string) {
  return apiRequest<{ success: boolean }>(`${testingItemsUrl(quotationId, revisionId)}/${itemId}`, {
    method: "DELETE",
    accessToken,
  });
}

// --- Phase 3 — Reference data (Step 8, read-only per D6) ------------------

export function listTrades(accessToken: string) {
  return apiRequest<Trade[]>("/trades", { accessToken });
}
export function listQuotationTemplates(accessToken: string) {
  return apiRequest<QuotationTermTemplate[]>("/quotation-templates", { accessToken });
}
export function listInquirySources(accessToken: string) {
  return apiRequest<InquirySource[]>("/inquiry-sources", { accessToken });
}
export function listInquiryTypes(accessToken: string) {
  return apiRequest<InquiryType[]>("/inquiry-types", { accessToken });
}

export * from "./service-report-verification";
export * from "./service-report-confirmation";

// --- Phase 6 (Dashboard) --------------------------------------------------

// Global, cross-customer listing — distinct from listQuotationsForCustomer
// above. `status` is a comma-separated list, passed straight through to the
// existing quotations.read-gated endpoint (no new permission).
export function listQuotations(accessToken: string, status?: string) {
  return apiRequest<Quotation[]>(`/quotations${status ? `?status=${encodeURIComponent(status)}` : ""}`, {
    accessToken,
  });
}

// Global, cross-customer listing, gated on work_orders.read (unscoped) —
// Technician's own read_own view remains a separate, not-yet-built concern
// (GET /work-orders/mine already exists server-side but has no frontend
// consumer yet).
export function listWorkOrders(accessToken: string, status?: string, assignedOnly = false) {
  const query = new URLSearchParams();
  if (status) query.set("status", status);
  if (assignedOnly) query.set("scope", "assigned");
  return apiRequest<WorkOrder[]>(`/work-orders${query.size ? `?${query}` : ""}`, {
    accessToken,
  });
}

// The existing GET /audit-logs endpoint (Phase 1, audit_logs.read) — first
// frontend consumer as of Phase 6's Recent Activity section.
export function listAuditLogs(accessToken: string, take?: number) {
  return apiRequest<AuditLogEntry[]>(`/audit-logs${take ? `?take=${take}` : ""}`, { accessToken });
}

// --- Phase 4 (Operations Frontend) ----------------------------------------

export function getWorkOrder(accessToken: string, id: string) {
  return apiRequest<WorkOrder>(`/work-orders/${id}`, { accessToken });
}

export function listWorkOrdersForCustomer(accessToken: string, customerId: string) {
  return apiRequest<WorkOrder[]>(`/customers/${customerId}/work-orders`, { accessToken });
}

export interface CreateStandaloneWorkOrderInput {
  responsibleManagerId?: string;
  siteId: string;
  standaloneReason: string;
  standaloneReasonType: StandaloneReasonType;
  estimatedValue?: number;
  scheduledDate?: string;
  description?: string;
}
export function createStandaloneWorkOrder(accessToken: string, customerId: string, body: CreateStandaloneWorkOrderInput) {
  return apiRequest<WorkOrder>(`/customers/${customerId}/work-orders`, { method: "POST", body, accessToken });
}

// Path A — server-derives customer/site/scope/costing/checklist from the
// ACCEPTED revision; the only client input is an optional scheduledDate,
// applied identically to every Work Order the conversion produces.
export function convertQuotationToWorkOrders(
  accessToken: string,
  quotationId: string,
  revisionId: string,
  body: { scheduledDate?: string; responsibleManagerId?: string } = {},
) {
  return apiRequest<WorkOrder[]>(`/quotations/${quotationId}/revisions/${revisionId}/convert-to-work-orders`, {
    method: "POST",
    body,
    accessToken,
  });
}

export function generateMaintenanceVisits(accessToken: string, quotationId: string, revisionId: string, startDate: string) {
  return apiRequest<WorkOrder[]>(`/quotations/${quotationId}/revisions/${revisionId}/generate-maintenance-visits`, {
    method: "POST",
    body: { startDate },
    accessToken,
  });
}

export function listManagers(accessToken: string) {
  return apiRequest<Array<{ id: string; fullName: string }>>("/users/managers", { accessToken });
}

export function setResponsibleManager(accessToken: string, workOrderId: string, responsibleManagerId: string | null) {
  return apiRequest<WorkOrder>(`/work-orders/${workOrderId}/responsible-manager`, {
    method: "PATCH", body: { responsibleManagerId }, accessToken,
  });
}

export interface Member {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  status: "ACTIVE" | "INACTIVE" | "SUSPENDED";
  userRoles: Array<{ role: { id: string; name: string } }>;
}

export interface PendingRegistration {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  createdAt: string;
  requestedRole: { id: string; name: string };
}

export function listRequestableDesignations() {
  return apiRequest<import("@agileworks/shared-types").RequestableDesignation[]>("/auth/requestable-designations");
}
export function submitRegistration(body: import("@agileworks/shared-types").RegistrationRequestInput) {
  return apiRequest<import("@agileworks/shared-types").RegistrationResponse>("/auth/register", { method: "POST", body });
}
export function listPendingRegistrations(accessToken: string) {
  return apiRequest<PendingRegistration[]>("/users/registration-requests", { accessToken });
}
export function approveRegistration(accessToken: string, id: string, roleId: string) {
  return apiRequest<{ id: string; fullName: string; email: string }>(`/users/registration-requests/${id}/approve`, { method: "POST", body: { roleId }, accessToken });
}
export function declineRegistration(accessToken: string, id: string) {
  return apiRequest<{ declined: boolean }>(`/users/registration-requests/${id}`, { method: "DELETE", accessToken });
}

export interface MemberRole { id: string; name: string }

export function listMembers(accessToken: string) { return apiRequest<Member[]>("/users", { accessToken }); }
export function listMemberRoles(accessToken: string) { return apiRequest<MemberRole[]>("/roles", { accessToken }); }
export function createMember(accessToken: string, body: { fullName: string; email: string; phone?: string; password: string }) {
  return apiRequest<Member>("/users", { method: "POST", body, accessToken });
}
export function setMemberStatus(accessToken: string, id: string, status: Member["status"]) {
  return apiRequest<Member>(`/users/${id}/status`, { method: "PATCH", body: { status }, accessToken });
}
export function assignMemberRole(accessToken: string, id: string, roleId: string) {
  return apiRequest(`/users/${id}/roles/${roleId}`, { method: "POST", accessToken });
}
export function revokeMemberRole(accessToken: string, id: string, roleId: string) {
  return apiRequest(`/users/${id}/roles/${roleId}`, { method: "DELETE", accessToken });
}

export function scheduleWorkOrder(accessToken: string, id: string, scheduledDate?: string) {
  return apiRequest<WorkOrder>(`/work-orders/${id}/schedule`, { method: "PATCH", body: { scheduledDate }, accessToken });
}

// Technician self-start — used by apps/field, backend-verified against an
// active assignment row, never just the permission grant.
export function startWorkOrder(accessToken: string, id: string) {
  return apiRequest<WorkOrder>(`/work-orders/${id}/start`, { method: "PATCH", accessToken });
}

export function completeWorkOrder(accessToken: string, id: string) {
  return apiRequest<WorkOrder>(`/work-orders/${id}/complete`, { method: "PATCH", accessToken });
}

export function closeWorkOrder(accessToken: string, id: string) {
  return apiRequest<WorkOrder>(`/work-orders/${id}/close`, { method: "PATCH", accessToken });
}

export function requestCancelWorkOrder(accessToken: string, id: string, reason: string) {
  return apiRequest<WorkOrder>(`/work-orders/${id}/request-cancel`, { method: "PATCH", body: { reason }, accessToken });
}

export function cancelWorkOrder(accessToken: string, id: string, reason: string) {
  return apiRequest<WorkOrder>(`/work-orders/${id}/cancel`, { method: "PATCH", body: { reason }, accessToken });
}

export function dismissCancellationRequest(accessToken: string, id: string) {
  return apiRequest<WorkOrder>(`/work-orders/${id}/dismiss-cancellation-request`, { method: "PATCH", accessToken });
}

// The minimal technician picker (approved Decision 1) — GET /users/technicians,
// gated on work_orders.assign, never users.manage.
export function listTechnicians(accessToken: string) {
  return apiRequest<TechnicianOption[]>("/users/technicians", { accessToken });
}

export function listAssignments(accessToken: string, workOrderId: string) {
  return apiRequest<WorkOrderAssignment[]>(`/work-orders/${workOrderId}/assignments`, { accessToken });
}

export function assignTechnician(accessToken: string, workOrderId: string, technicianId: string) {
  return apiRequest<WorkOrderAssignment>(`/work-orders/${workOrderId}/assignments`, {
    method: "POST",
    body: { technicianId },
    accessToken,
  });
}

export function unassignTechnician(accessToken: string, workOrderId: string, assignmentId: string) {
  return apiRequest<WorkOrderAssignment>(`/work-orders/${workOrderId}/assignments/${assignmentId}/unassign`, {
    method: "PATCH",
    accessToken,
  });
}

// The Work-Order-scoped Service Reports listing (approved Decision 1) —
// never duplicates anything about how those reports are themselves
// extracted/verified/confirmed/locked; this only lists rows Phase 5's own
// pipeline already produced, reusing its existing ServiceReportListItem
// shape.
export function listServiceReportsForWorkOrder(accessToken: string, workOrderId: string) {
  return apiRequest<ServiceReportListItem[]>(`/work-orders/${workOrderId}/service-reports`, { accessToken });
}
