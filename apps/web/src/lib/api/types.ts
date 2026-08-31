// Hand-typed to match exactly what the Steps 1-7 API actually returns over
// the wire — Prisma Decimal fields (geoLat/geoLng/capacityValue) serialize
// to strings via their own toJSON(), not numbers, so they're typed as such
// here rather than assumed.

export type CustomerType = "RESIDENTIAL" | "COMMERCIAL" | "INDUSTRIAL";
export type CustomerStatus = "ACTIVE" | "INACTIVE";
export type ContactStatus = "ACTIVE" | "INACTIVE";
export type SiteStatus = "ACTIVE" | "INACTIVE";
export type EquipmentSystemStatus = "ACTIVE" | "INACTIVE";
export type AssetStatus = "ACTIVE" | "OUT_OF_SERVICE" | "DECOMMISSIONED";
export type ReferenceStatus = "ACTIVE" | "INACTIVE";
export type DocumentRelatedType = "CUSTOMER" | "SITE" | "ASSET";
export type DocumentType = "CONTRACT" | "WARRANTY" | "PHOTO" | "MANUAL" | "COMPLIANCE_CERT" | "OTHER";

export interface Customer {
  id: string;
  name: string;
  customerType: CustomerType;
  billingAddress: string;
  taxId: string | null;
  phone: string | null;
  email: string | null;
  accountManagerId: string | null;
  status: CustomerStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Contact {
  id: string;
  customerId: string;
  fullName: string;
  designation: string | null;
  phone: string | null;
  email: string | null;
  isPrimary: boolean;
  status: ContactStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Site {
  id: string;
  customerId: string;
  label: string;
  addressLine: string;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  geoLat: string | null;
  geoLng: string | null;
  primaryContactId: string | null;
  accessNotes: string | null;
  status: SiteStatus;
  createdAt: string;
  updatedAt: string;
}

export interface EquipmentSystem {
  id: string;
  siteId: string;
  name: string;
  systemTypeCode: string;
  status: EquipmentSystemStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Asset {
  id: string;
  siteId: string;
  equipmentSystemId: string | null;
  parentAssetId: string | null;
  assetTag: string;
  equipmentTypeCode: string;
  brand: string | null;
  modelNo: string | null;
  serialNo: string | null;
  capacityValue: string | null;
  capacityUnitCode: string | null;
  refrigerantType: string | null;
  locationInSite: string | null;
  installDate: string | null;
  warrantyExpiry: string | null;
  status: AssetStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EquipmentType {
  code: string;
  label: string;
  sortOrder: number;
  status: ReferenceStatus;
}

export interface EquipmentSystemType {
  code: string;
  label: string;
  sortOrder: number;
  status: ReferenceStatus;
}

export interface CapacityUnit {
  code: string;
  label: string;
  sortOrder: number;
  status: ReferenceStatus;
}

export interface CustomerDocument {
  id: string;
  relatedType: DocumentRelatedType;
  relatedId: string;
  documentType: DocumentType;
  fileKey: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  checksumSha256: string;
  uploadedBy: string | null;
  uploadedAt: string;
  caption: string | null;
  description: string | null;
  createdAt: string;
}

export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  CONTRACT: "Contract",
  WARRANTY: "Warranty",
  PHOTO: "Photo",
  MANUAL: "Manual",
  COMPLIANCE_CERT: "Compliance Certificate",
  OTHER: "Other",
};

export const CUSTOMER_TYPE_LABEL: Record<CustomerType, string> = {
  RESIDENTIAL: "Residential",
  COMMERCIAL: "Commercial",
  INDUSTRIAL: "Industrial",
};

// --- Phase 3 — Sales Workflow (Step 8) --------------------------------
// Hand-typed to match exactly what Steps 1-7 actually return over the wire —
// same convention as everything above. Every Decimal field (quantity,
// amounts, percentages) is a string, never a number, matching Prisma's own
// Decimal.toJSON() serialization.

export type InquiryStatus = "OPEN" | "CONVERTED" | "CLOSED";
export type QuotationType = "REPAIR" | "PREVENTIVE_MAINTENANCE" | "SUPPLY_INSTALLATION" | "PROJECT";
export type QuotationRevisionStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "SENT"
  | "ACCEPTED"
  | "DECLINED"
  | "EXPIRED"
  | "SUPERSEDED";
export type TaxTreatment = "VAT_INCLUSIVE" | "VAT_EXEMPT";
export type MaintenanceFrequency = "WEEKLY" | "MONTHLY" | "QUARTERLY" | "SEMI_ANNUAL" | "ANNUAL" | "CUSTOM";
export type MaintenanceBillingFrequency = "MONTHLY" | "QUARTERLY" | "SEMI_ANNUAL" | "ANNUAL" | "PER_VISIT" | "LUMP_SUM";
export type CustomerDecision = "ACCEPTED" | "DECLINED";

export interface Trade {
  code: string;
  label: string;
  sortOrder: number;
  status: ReferenceStatus;
}

export interface InquirySource {
  code: string;
  label: string;
  sortOrder: number;
  status: ReferenceStatus;
}

export interface InquiryType {
  code: string;
  label: string;
  sortOrder: number;
  status: ReferenceStatus;
}

export interface QuotationTermTemplate {
  id: string;
  name: string;
  quotationType: QuotationType | null;
  tradeCode: string | null;
  body: string;
  isDefault: boolean;
  status: ReferenceStatus;
}

export interface Inquiry {
  id: string;
  inquiryNumber: string;
  customerId: string;
  siteId: string | null;
  contactId: string | null;
  sourceCode: string | null;
  tradeCode: string | null;
  inquiryTypeCode: string | null;
  subject: string;
  description: string | null;
  customerReferenceNo: string | null;
  preferredServiceDate: string | null;
  status: InquiryStatus;
  closedAt: string | null;
  convertedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Quotation {
  id: string;
  inquiryId: string | null;
  customerId: string;
  siteId: string;
  quotationNumber: string;
  quotationType: QuotationType;
  primaryTradeCode: string;
  customerReferenceNo: string | null;
  // Denormalized mirror of the current revision's status — see apps/api's
  // schema.prisma comment on quotations.status. Always trust this for list
  // views; never re-derive it client-side.
  status: QuotationRevisionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface QuotationRevision {
  id: string;
  quotationId: string;
  revisionNumber: number;
  isCurrent: boolean;
  status: QuotationRevisionStatus;
  scopeOfWork: string | null;
  defaultTaxTreatment: TaxTreatment;
  vatRatePercent: string;
  subtotal: string;
  netAmount: string;
  vatAmount: string;
  discountPercent: string;
  discountAmount: string;
  totalAmount: string;
  paymentTerms: string | null;
  warranty: string | null;
  leadTime: string | null;
  notes: string | null;
  exclusions: string | null;
  termsAndConditions: string | null;
  validUntil: string | null;
  createdBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  sentAt: string | null;
  customerDecisionAt: string | null;
  expiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuotationSection {
  id: string;
  quotationRevisionId: string;
  name: string;
  tradeCode: string | null;
  sortOrder: number;
  netAmount: string;
  vatAmount: string;
  finalAmount: string;
}

// Internal-only fields (unitCostExpense, markupPercent, totalInternalCost,
// grossProfitAmount, grossMarginPercent) ride along with the same
// quotations.read grant as everything else (§06a/§11) — no separate typing
// needed, but UI components must render them in a visually distinct
// "Internal" area, never mixed into the customer-facing selling info.
export interface QuotationLineItem {
  id: string;
  quotationRevisionId: string;
  sectionId: string | null;
  assetId: string | null;
  description: string;
  specification: string | null;
  brand: string | null;
  model: string | null;
  quantity: string;
  unit: string;
  unitCostExpense: string | null;
  markupPercent: string | null;
  unitPriceBeforeVat: string;
  totalInternalCost: string | null;
  grossProfitAmount: string | null;
  grossMarginPercent: string | null;
  taxTreatment: TaxTreatment;
  unitPrice: string;
  materialAmount: string | null;
  laborAmount: string | null;
  lineAmount: string;
  lineDiscountAmount: string;
  lineFinalAmount: string;
  lineNetAmount: string;
  lineVatAmount: string;
  sortOrder: number;
}

export interface QuotationMaintenanceDetails {
  quotationRevisionId: string;
  contractPeriodMonths: number;
  frequency: MaintenanceFrequency;
  scheduledVisits: number;
  billingFrequency: MaintenanceBillingFrequency;
}

export interface QuotationTestingCommissioningItem {
  id: string;
  quotationRevisionId: string;
  description: string;
  included: boolean;
  sortOrder: number;
}

export const QUOTATION_TYPE_LABEL: Record<QuotationType, string> = {
  REPAIR: "Repair",
  PREVENTIVE_MAINTENANCE: "Preventive Maintenance",
  SUPPLY_INSTALLATION: "Supply & Installation",
  PROJECT: "Project",
};

export const TAX_TREATMENT_LABEL: Record<TaxTreatment, string> = {
  VAT_INCLUSIVE: "VAT Inclusive",
  VAT_EXEMPT: "VAT Exempt (EX)",
};

export const MAINTENANCE_FREQUENCY_LABEL: Record<MaintenanceFrequency, string> = {
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  SEMI_ANNUAL: "Semi-Annual",
  ANNUAL: "Annual",
  CUSTOM: "Custom",
};

export const MAINTENANCE_BILLING_FREQUENCY_LABEL: Record<MaintenanceBillingFrequency, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  SEMI_ANNUAL: "Semi-Annual",
  ANNUAL: "Annual",
  PER_VISIT: "Per Visit",
  LUMP_SUM: "Lump Sum",
};

// The revision lifecycle from §10 of the frozen Phase 3 plan — used to
// decide which action buttons are valid from the current status, mirroring
// the backend's own precondition guards (UX only; the server remains
// authoritative). Kept here as the one shared source of truth for the state
// machine shape, instead of re-deriving it in each component.
export const REVISION_TERMINAL_STATUSES: QuotationRevisionStatus[] = [
  "ACCEPTED",
  "DECLINED",
  "REJECTED",
  "EXPIRED",
  "SUPERSEDED",
];

// --- Phase 4 (Work Orders) — hand-typed here for the first time as of
// Phase 6 (Dashboard), since no frontend page consumed this module before
// now. Deliberately minimal: only the fields the Dashboard's KPI cards and
// the new GET /work-orders?status=... endpoint actually need, not every
// column on the backend model.
export type WorkOrderStatus = "DRAFT" | "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CLOSED" | "CANCELLED";

export type WorkOrderType = "FROM_QUOTATION" | "STANDALONE";
export type StandaloneReasonType = "EMERGENCY" | "WARRANTY" | "CALLBACK" | "INTERNAL" | "OTHER";
export type WorkOrderTaskStatus = "PENDING" | "DONE" | "SKIPPED";

// Phase 4 Operations Frontend — the active-assignment shape the backend
// enriches every list/detail Work Order response with (approved Decision
// 5): one row per currently-active (unassignedAt IS NULL) technician,
// joined server-side so the frontend never fetches this per-row.
export interface WorkOrderAssignment {
  id: string;
  technicianId: string;
  assignedAt: string;
  technician: { id: string; fullName: string };
}

export interface WorkOrderTask {
  id: string;
  description: string;
  sortOrder: number;
  status: WorkOrderTaskStatus;
}

export interface WorkOrder {
  id: string;
  workOrderNumber: string;
  customerId: string;
  siteId: string;
  quotationId: string | null;
  quotationRevisionId: string | null;
  workOrderType: WorkOrderType;
  standaloneReason: string | null;
  standaloneReasonType: StandaloneReasonType | null;
  estimatedValue: string | null;
  status: WorkOrderStatus;
  scheduledDate: string | null;
  description: string | null;
  startedAt: string | null;
  completedAt: string | null;
  closedAt: string | null;
  cancellationRequestedAt: string | null;
  cancellationRequestedReason: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
  // Read-only enrichment (approved Decision 5) — always present on every
  // list/detail response, never sent by the client. `tasks` is present
  // only on the single-Work-Order detail response, not on list responses.
  customer: { id: string; name: string };
  site: { id: string; label: string };
  assignments: WorkOrderAssignment[];
  tasks?: WorkOrderTask[];
}

export type UserStatus = "ACTIVE" | "INACTIVE" | "SUSPENDED";

// Phase 4 Operations Frontend — the minimal technician-picker shape
// returned by GET /users/technicians (deliberately narrower than a full
// User record — see that endpoint's own approved scope).
export interface TechnicianOption {
  id: string;
  fullName: string;
  status: UserStatus;
}

// --- Phase 6 (Dashboard) — the existing GET /audit-logs endpoint's row
// shape (AuditService/AuditController, unchanged since Phase 1). Never
// written from the frontend — read-only, matching the backend's own
// append-only contract.
export interface AuditLogEntry {
  id: string;
  actorType: "USER" | "SYSTEM" | "WORKER" | "INTEGRATION";
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
}
