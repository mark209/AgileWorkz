import * as fs from "node:fs";
import * as path from "node:path";
import * as dotenv from "dotenv";

// Runs via `tsx prisma/seed.ts` directly, not through the Prisma CLI — tsx
// does not auto-load .env the way Prisma's own CLI commands do, so without
// this, DATABASE_URL and SEED_ADMIN_* would all be undefined in local dev.
//
// A hosting platform (e.g. Render) injects DATABASE_URL and the SEED_ADMIN_*
// variables directly into process.env — there is no physical .env file on
// disk there, and there never should be. Check process.env FIRST; only fall
// back to loading a local .env file when DATABASE_URL isn't already present,
// which is exactly the local-dev case tsx needs help with.
if (!process.env.DATABASE_URL) {
  // dotenv.config() never throws on a missing/wrong path — it silently no-ops
  // — so a resolution mistake here would surface only much later as a
  // confusing Prisma error with no indication .env was ever involved. Try two
  // candidate locations (relative to this file, and relative to wherever the
  // process was launched from — cwd and __dirname can disagree across
  // platforms/shells) and fail loudly, immediately, and specifically if
  // neither one actually loaded DATABASE_URL — before Prisma is ever touched.
  const candidatePaths = [
    path.resolve(__dirname, "..", ".env"), // relative to prisma/, i.e. repo root
    path.resolve(process.cwd(), ".env"), // relative to the shell's working directory
  ];

  let loadedFrom: string | undefined;
  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      if (process.env.DATABASE_URL) {
        loadedFrom = candidate;
        break;
      }
    }
  }

  if (!loadedFrom) {
    throw new Error(
      "DATABASE_URL is not set in the environment, and could not be loaded from .env. Tried:\n" +
        candidatePaths.map((p) => `  - ${p} (exists: ${fs.existsSync(p)})`).join("\n") +
        "\nEither set DATABASE_URL directly in the environment (e.g. on a hosting platform), " +
        "or create .env at the repo root (copy .env.example) and set DATABASE_URL, or run this script from the repo root.",
    );
  }
  console.log(`Loaded environment from: ${loadedFrom}`);
} else {
  console.log("DATABASE_URL already present in process.env — using it directly, no .env file needed.");
}

import { PrismaClient, ActorType } from "@prisma/client";
import * as argon2 from "argon2";

const prisma = new PrismaClient();

const ROLE_NAMES = ["Admin/Owner", "Manager", "Office Staff", "Technician"] as const;

// Phase 1 only seeds permissions for modules that actually have a table this phase.
const PHASE1_PERMISSIONS: Array<{ module: string; action: string; description: string }> = [
  { module: "users", action: "manage", description: "Create, update, and change status of any user; grant/revoke roles" },
  { module: "roles", action: "manage", description: "Create/update roles and their permission grants" },
  { module: "system_settings", action: "manage", description: "View and update configurable business parameters" },
  { module: "audit_logs", action: "read", description: "View the audit trail" },
];

// Phase 2 — Customer, Site & Equipment domain. Matches the approved Phase 2
// plan §06 exactly: create/read/update/deactivate for the five business
// entities, upload/read/delete for documents, read/manage for the three
// controlled-value reference tables.
const PHASE2_PERMISSIONS: Array<{ module: string; action: string; description: string }> = [
  { module: "customers", action: "create", description: "Create new customer records" },
  { module: "customers", action: "read", description: "View customer records" },
  { module: "customers", action: "update", description: "Edit customer profile fields" },
  { module: "customers", action: "deactivate", description: "Change a customer's status between Active and Inactive" },

  { module: "contacts", action: "create", description: "Create new contact records for a customer" },
  { module: "contacts", action: "read", description: "View contact records" },
  { module: "contacts", action: "update", description: "Edit contact fields" },
  { module: "contacts", action: "deactivate", description: "Change a contact's status between Active and Inactive" },

  { module: "sites", action: "create", description: "Create new site records for a customer" },
  { module: "sites", action: "read", description: "View site records" },
  { module: "sites", action: "update", description: "Edit site fields" },
  { module: "sites", action: "deactivate", description: "Change a site's status between Active and Inactive" },

  { module: "assets", action: "create", description: "Register new HVAC/electrical equipment" },
  { module: "assets", action: "read", description: "View equipment records" },
  { module: "assets", action: "update", description: "Edit equipment fields, including parent/system linking" },
  { module: "assets", action: "deactivate", description: "Change an asset's status (Active / Out of Service / Decommissioned)" },

  { module: "equipment_systems", action: "create", description: "Create a new logical equipment system grouping" },
  { module: "equipment_systems", action: "read", description: "View equipment system groupings" },
  { module: "equipment_systems", action: "update", description: "Edit an equipment system's fields" },
  { module: "equipment_systems", action: "deactivate", description: "Change an equipment system's status between Active and Inactive" },

  { module: "customer_documents", action: "upload", description: "Upload a document against a customer, site, or asset" },
  { module: "customer_documents", action: "read", description: "View or download an uploaded document" },
  { module: "customer_documents", action: "delete", description: "Remove an uploaded document" },

  { module: "capacity_units", action: "read", description: "View the list of capacity units" },
  { module: "capacity_units", action: "manage", description: "Add or deactivate a capacity unit" },

  { module: "equipment_types", action: "read", description: "View the list of equipment types" },
  { module: "equipment_types", action: "manage", description: "Add or deactivate an equipment type" },

  { module: "equipment_system_types", action: "read", description: "View the list of equipment system types" },
  { module: "equipment_system_types", action: "manage", description: "Add or deactivate an equipment system type" },
];

// Office Staff gets create/read/update but never deactivate on the five
// business entities, upload/read but never delete on documents, and
// read-only on the three reference tables — Admin/Owner gets every Phase 2
// permission; Technician gets none yet (approved Decision 2 — deferred to
// Phase 4's work-order-scoped access).
const OFFICE_STAFF_PHASE2_GRANTS = [
  "customers.create", "customers.read", "customers.update",
  "contacts.create", "contacts.read", "contacts.update",
  "sites.create", "sites.read", "sites.update",
  "assets.create", "assets.read", "assets.update",
  "equipment_systems.create", "equipment_systems.read", "equipment_systems.update",
  "customer_documents.upload", "customer_documents.read",
  "capacity_units.read",
  "equipment_types.read",
  "equipment_system_types.read",
] as const;

// RBAC correction (post-Phase-7 pilot review): Manager is NOT simply
// Admin/Owner minus system administration. Routine creation/maintenance of
// customer/site/equipment master data belongs to Office Staff; Manager
// retains only the read access needed for service-management context (e.g.
// deciding scheduling/assignment, understanding a Work Order's site/
// equipment). Manager never held customer_documents.upload/delete under
// this correction, and reference-table .manage (capacity_units/
// equipment_types/equipment_system_types) moves to Admin/Owner-only —
// company/reference configuration, not service operations.
const MANAGER_PHASE2_GRANTS = [
  "customers.read",
  "contacts.read",
  "sites.read",
  "assets.read",
  "equipment_systems.read",
  "customer_documents.read",
  "capacity_units.read",
  "equipment_types.read",
  "equipment_system_types.read",
] as const;

// Phase 3 Step 2 — Sales Workflow permissions. Matches the approved Phase 3
// plan §11 RBAC table exactly (the table's "quotations.approve" row is a
// compact way of writing "the approve/reject actions on the quotations
// module" — module/action stay flat pairs, consistent with every other
// permission in this file, so it becomes quotations.approve + quotations.reject
// here, not a literal "quotations.approve" module string).
//
// "inquiries" permissions are intentionally NOT seeded here. Per the Step 1
// approval note, the Inquiries module (table, endpoints, and the real
// Quotation<->Inquiry FK) is Step 3 — seeding permissions for a module with
// no table or endpoints yet would be premature and untestable.
const PHASE3_PERMISSIONS: Array<{ module: string; action: string; description: string }> = [
  { module: "quotations", action: "create", description: "Create a new quotation (header + Revision 0)" },
  { module: "quotations", action: "read", description: "View quotations and their revisions" },
  { module: "quotations", action: "update", description: "Edit a DRAFT revision's content — sections, line items, terms, amounts" },
  { module: "quotations", action: "approve", description: "Approve a PENDING_APPROVAL revision — Level 1 (Manager). Finalizes it if <=50k; advances to PENDING_OWNER_APPROVAL if >50k" },
  { module: "quotations", action: "reject", description: "Reject a PENDING_APPROVAL revision — Level 1 (Manager), terminal, never reaches Owner" },
  {
    module: "quotations",
    action: "approve_final",
    description: "Approve a PENDING_OWNER_APPROVAL revision — Level 2 (Owner), final. Only reachable after Manager's Level 1 approval",
  },
  {
    module: "quotations",
    action: "reject_final",
    description: "Reject a PENDING_OWNER_APPROVAL revision — Level 2 (Owner), terminal",
  },

  { module: "trades", action: "read", description: "View the list of trades/disciplines" },
  { module: "trades", action: "manage", description: "Add or deactivate a trade" },

  { module: "quotation_templates", action: "read", description: "View quotation Terms & Conditions templates" },
  { module: "quotation_templates", action: "manage", description: "Add or deactivate a quotation Terms & Conditions template" },
];

// Office Staff gets full create/read/update on quotations but never
// approve/reject (that's the Manager threshold-gate action per §09/§11), and
// read-only on the two reference tables — matches the approved RBAC table
// exactly. Admin/Owner gets every Phase 3 permission. Technician gets
// nothing yet, same deferred-access decision as Phase 2.
const OFFICE_STAFF_PHASE3_GRANTS = [
  "quotations.create", "quotations.read", "quotations.update",
  "trades.read",
  "quotation_templates.read",
  "inquiry_sources.read",
  "inquiry_types.read",
] as const;

// RBAC correction: Manager keeps quotation approve/reject (its actual job —
// the current single-global-threshold gate, pending the separately-approved
// tiered approval policy) plus read access for context, but loses
// create/update — quotation preparation belongs to Office Staff — and loses
// .manage on every Phase 3 reference table, same reasoning as Phase 2 above.
const MANAGER_PHASE3_GRANTS = [
  "quotations.read", "quotations.approve", "quotations.reject",
  "trades.read",
  "quotation_templates.read",
  "inquiry_sources.read",
  "inquiry_types.read",
] as const;

// Step 4 — the two reference tables the Step 3 correction created but
// deliberately deferred RBAC for (see the Step 3 correction report). Same
// read/manage shape and same full/full/read-only/none-yet grant pattern as
// trades and quotation_templates above — no new RBAC pattern introduced.
const PHASE3_STEP4_REFERENCE_PERMISSIONS: Array<{ module: string; action: string; description: string }> = [
  { module: "inquiry_sources", action: "read", description: "View the list of inquiry sources" },
  { module: "inquiry_sources", action: "manage", description: "Add or deactivate an inquiry source" },
  { module: "inquiry_types", action: "read", description: "View the list of inquiry types" },
  { module: "inquiry_types", action: "manage", description: "Add or deactivate an inquiry type" },
];

// Approved Phase 3 trade list — phase3-plan.html §02. A new trade later is a
// seeded row, never a migration.
const TRADES: Array<{ code: string; label: string; sortOrder: number }> = [
  { code: "HVAC", label: "HVAC / Airconditioning", sortOrder: 0 },
  { code: "ELECTRICAL", label: "Electrical", sortOrder: 10 },
  { code: "FDAS", label: "Fire Detection & Alarm System", sortOrder: 20 },
  { code: "GENERATOR", label: "Generator", sortOrder: 30 },
  { code: "CIVIL_FITOUT", label: "Civil / Fit-out", sortOrder: 40 },
  { code: "MULTI_TRADE", label: "Multi-Trade", sortOrder: 50 },
  { code: "OTHER", label: "Other", sortOrder: 60 },
];

// Fixed, well-known ID so this single starter row stays idempotent across
// repeated seed runs — QuotationTermTemplate has no natural unique business
// key (unlike every other seeded model here), and adding one now would mean
// touching the already-migrated, already-approved Phase 3 Step 1 schema,
// which is explicitly out of scope for Step 2.
const DEFAULT_QUOTATION_TERM_TEMPLATE_ID = "00000000-0000-0000-0000-000000000001";

// Deliberately placeholder text, not real AgileWorks T&C content — this repo
// has no source of your actual terms to seed verbatim. This one row exists
// only so the type+trade template-selection fallback (approved plan §08:
// exact match, then type-only, then this global is_default row) always
// resolves to something rather than finding zero templates. Replace the body
// with your real standard terms before any quotation using it is sent to a
// customer — flagged again in the Step 2 report.
const DEFAULT_QUOTATION_TERM_TEMPLATE_BODY =
  "[PLACEHOLDER — replace with AgileWorks' actual standard Terms & Conditions " +
  "before this template is used on a real quotation. Seeded only so the " +
  "type+trade template-selection fallback always resolves to a row.]";

// Phase 3 Step 2 system settings — approved plan §05a (numbering prefix) and
// §06/§06a (default VAT rate). Kept as its own array/type (STRING as well as
// NUMBER) rather than widening SYSTEM_SETTINGS below, so the Phase 1 array's
// existing type and values are untouched.
const PHASE3_SYSTEM_SETTINGS: Array<{ key: string; value: string; valueType: "NUMBER" | "STRING"; description: string }> = [
  {
    key: "vat_rate_percent",
    value: "12",
    valueType: "NUMBER",
    description: "Default VAT rate (%) applied to new quotation revisions (vat_rate_percent) unless overridden — approved Phase 3 tax model, §06.",
  },
  {
    key: "quotation_number_prefix",
    value: "QT",
    valueType: "STRING",
    description: "Configurable prefix for generated quotation numbers (format PREFIX-YYYY-MM-NNNNN). Changing this does not affect already-issued numbers or the underlying monthly counter — see §05a.",
  },
  {
    key: "inquiry_number_prefix",
    value: "INQ",
    valueType: "STRING",
    description: "Configurable prefix for generated inquiry numbers (format PREFIX-YYYY-MM-NNNNN), same numbering engine as quotations — Step 3 correction.",
  },
  {
    key: "default_tax_treatment",
    value: "VAT_INCLUSIVE",
    valueType: "STRING",
    description:
      "Configurable default tax_treatment (VAT_INCLUSIVE or VAT_EXEMPT) used when a quotation-create request omits one — Step 5. " +
      "A configurable default, not a hardcoded business rule; the resolved value is snapshotted onto Revision 0 at creation and later " +
      "changes to this setting never affect already-created revisions.",
  },
];

// Phase 3 Step 3 — Inquiries. Deferred from Step 2 specifically because the
// module/table didn't exist yet — see the Step 2 report. Matches the
// approved plan §11 RBAC row for create/read/update — full for Admin/Owner,
// Manager, and Office Staff alike; Technician gets nothing yet. `close` is a
// Step 3 correction: its own permission, matching the Phase 2 precedent of
// every other status-transition endpoint (*.deactivate) having a separate
// action rather than riding along with update.
const PHASE3_INQUIRIES_PERMISSIONS: Array<{ module: string; action: string; description: string }> = [
  { module: "inquiries", action: "create", description: "Create a new inquiry for a customer" },
  { module: "inquiries", action: "read", description: "View inquiries" },
  { module: "inquiries", action: "update", description: "Edit an OPEN inquiry's fields" },
  { module: "inquiries", action: "close", description: "Close an OPEN inquiry (lost lead, not converted)" },
];

// RBAC correction: Manager keeps read-only visibility (e.g. tracing a Work
// Order back to its originating inquiry) — routine inquiry creation/
// maintenance/closing belongs to Office Staff, same reasoning as Phase 2/3.
const MANAGER_INQUIRIES_GRANTS = ["inquiries.read"] as const;

// Step 3 correction — approved seed list, SMS and Viber kept as separate,
// independently reportable channels per your explicit instruction.
// inquiry_types is NOT seeded here: no initial list has been approved yet,
// so the table is created (Step 3 correction migration) but left empty
// until you provide one — see the Step 3 correction report.
const INQUIRY_SOURCES: Array<{ code: string; label: string; sortOrder: number }> = [
  { code: "PHONE", label: "Phone Call", sortOrder: 0 },
  { code: "EMAIL", label: "Email", sortOrder: 10 },
  { code: "SMS", label: "SMS/Text", sortOrder: 20 },
  { code: "VIBER", label: "Viber", sortOrder: 30 },
  { code: "MESSENGER", label: "Facebook Messenger", sortOrder: 40 },
  { code: "WEBSITE", label: "Website", sortOrder: 50 },
  { code: "REFERRAL", label: "Referral", sortOrder: 60 },
  { code: "WALK_IN", label: "Walk-in", sortOrder: 70 },
  { code: "OTHER", label: "Other", sortOrder: 80 },
];

const CAPACITY_UNITS: Array<{ code: string; label: string; sortOrder: number }> = [
  { code: "TR", label: "Tons of Refrigeration", sortOrder: 0 },
  { code: "HP", label: "Horsepower", sortOrder: 10 },
  { code: "BTU_HR", label: "BTU per Hour", sortOrder: 20 },
  { code: "KW", label: "Kilowatts", sortOrder: 30 },
];

// Approved equipment type list, plus ELECTRICAL_PANEL (approved separately
// to accommodate electrical assets tied to HVAC/electrical service work —
// deliberately not a broader electrical taxonomy).
const EQUIPMENT_TYPES: Array<{ code: string; label: string; sortOrder: number }> = [
  { code: "SPLIT_INDOOR", label: "Split Type — Indoor Unit", sortOrder: 0 },
  { code: "SPLIT_OUTDOOR", label: "Split Type — Outdoor Unit", sortOrder: 10 },
  { code: "MULTISPLIT_INDOOR", label: "Multi-Split — Indoor Unit", sortOrder: 20 },
  { code: "MULTISPLIT_OUTDOOR", label: "Multi-Split — Outdoor Unit", sortOrder: 30 },
  { code: "VRV_VRF_INDOOR", label: "VRV/VRF — Indoor Unit", sortOrder: 40 },
  { code: "VRV_VRF_OUTDOOR", label: "VRV/VRF — Outdoor Module", sortOrder: 50 },
  { code: "DUCTABLE", label: "Ductable Split Unit", sortOrder: 60 },
  { code: "PACKAGE_UNIT", label: "Package Unit", sortOrder: 70 },
  { code: "FCU", label: "Fan Coil Unit", sortOrder: 80 },
  { code: "AHU", label: "Air Handling Unit", sortOrder: 90 },
  { code: "CHILLER", label: "Chiller", sortOrder: 100 },
  { code: "COOLING_TOWER", label: "Cooling Tower", sortOrder: 110 },
  { code: "PUMP", label: "Pump", sortOrder: 120 },
  { code: "ELECTRICAL_PANEL", label: "Electrical Panel", sortOrder: 130 },
  { code: "OTHER", label: "Other", sortOrder: 140 },
];

const EQUIPMENT_SYSTEM_TYPES: Array<{ code: string; label: string; sortOrder: number }> = [
  { code: "SPLIT", label: "Split System", sortOrder: 0 },
  { code: "MULTI_SPLIT", label: "Multi-Split System", sortOrder: 10 },
  { code: "VRV_VRF", label: "VRV/VRF System", sortOrder: 20 },
  { code: "CHILLED_WATER", label: "Chilled Water Plant", sortOrder: 30 },
  { code: "PACKAGE", label: "Package System", sortOrder: 40 },
  { code: "OTHER", label: "Other", sortOrder: 50 },
];

const SYSTEM_SETTINGS: Array<{ key: string; value: string; valueType: "NUMBER"; description: string }> = [
  {
    key: "quotation_approval_threshold_php",
    value: "50000",
    valueType: "NUMBER",
    description:
      "Two-level approval correction: revisions at or below this amount (PHP) need Manager approval only; above it need Manager (Level 1) then Owner (Level 2) approval, sequentially. Amount-only — discount percentage plays no part in approval routing.",
  },
  // quotation_discount_threshold_pct — deliberately NOT seeded here anymore.
  // Two-level approval correction: discount percentage no longer affects
  // who approves a quotation; only the total amount does. The existing row
  // (if already present in a given database) is left untouched rather than
  // deleted, per the approved instruction not to remove data merely for
  // cleanliness — it is simply unread by any code path now.
  {
    key: "document_retention_years",
    value: "7",
    valueType: "NUMBER",
    description: "Default retention period, in years, for Service Report documents, staging records, and audit logs.",
  },
];

// Phase 4 Step 2 — Operations: Work Orders & Technician Assignment.
// Matches the approved Phase 4 plan §07 RBAC matrix exactly. Two ownership-
// scoped action shapes beyond the standard create/read/update — read_own and
// start_own — exist only for Technician; they are deliberately NOT granted to
// Admin/Owner or Manager (who already hold the superset "read"/full write
// permissions, making the scoped variants redundant for them), which is why
// this phase does not reuse the "grant every permission in the map to
// Admin/Owner and Manager" loop used by every prior phase — see the three
// separate grant-key lists below instead.
const PHASE4_PERMISSIONS: Array<{ module: string; action: string; description: string }> = [
  { module: "work_orders", action: "create", description: "Create a new Work Order, from a quotation or standalone" },
  { module: "work_orders", action: "read", description: "View all Work Orders" },
  { module: "work_orders", action: "read_assigned", description: "View Work Orders explicitly assigned to the responsible Manager" },
  { module: "work_orders", action: "read_own", description: "View only Work Orders the caller is actively assigned to (Technician, backend-filtered)" },
  { module: "work_orders", action: "update", description: "Edit a Work Order's fields" },
  { module: "work_orders", action: "assign", description: "Assign, reassign, or unassign technicians on a Work Order" },
  { module: "work_orders", action: "start_own", description: "Move the caller's own assigned Work Order from SCHEDULED to IN_PROGRESS (Technician, backend-verified active assignment required)" },
  { module: "work_orders", action: "field_complete_own", description: "Mark the caller's actively-assigned Work Order field portion done, ready for office review (Technician, backend-verified). Status unchanged — office/management retains complete/close authority." },
  { module: "work_orders", action: "complete", description: "Mark a Work Order COMPLETED (field/technical execution finished)" },
  { module: "work_orders", action: "close", description: "Mark a Work Order CLOSED — final management sign-off after required records and applicable actual costs are reviewed" },
  { module: "work_orders", action: "request_cancel", description: "Request cancellation of a Work Order (does not itself change status)" },
  { module: "work_orders", action: "cancel", description: "Confirm/finalize cancellation of a Work Order — final authority" },
  { module: "work_orders", action: "generate_maintenance_visits", description: "Generate recurring maintenance-visit Work Orders from an accepted PM quotation" },
];

// Admin/Owner and Manager: every Phase 4 permission except the two
// Technician-only ownership-scoped actions (§07 table — identical column for
// both roles).
const ADMIN_MANAGER_PHASE4_GRANTS = [
  "work_orders.create", "work_orders.read", "work_orders.update", "work_orders.assign",
  "work_orders.complete", "work_orders.close", "work_orders.request_cancel", "work_orders.cancel",
  "work_orders.generate_maintenance_visits",
] as const;

// Office Staff: full operational set — create/read/update/assign/complete,
// request_cancel, generate_maintenance_visits — but never close or the final
// cancel (management-only, §07), and none of the Technician-only actions.
const OFFICE_STAFF_PHASE4_GRANTS = [
  "work_orders.create", "work_orders.read", "work_orders.update", "work_orders.assign",
  "work_orders.complete", "work_orders.request_cancel", "work_orders.generate_maintenance_visits",
] as const;

// Technician: the three ownership-scoped actions — no unscoped create,
// read, update, assign, complete, close, or cancel of any kind (§07 table).
// field_complete_own (RBAC correction) lets a Technician signal their own
// assigned job's field portion is done without granting general
// update/complete/close/cancel — status stays IN_PROGRESS; the real
// complete/close authority remains Office Staff/Manager/Admin-Owner only.
const TECHNICIAN_PHASE4_GRANTS = ["work_orders.read_own", "work_orders.start_own", "work_orders.field_complete_own"] as const;

// D9 — Work Order numbering uses the existing 5-digit numbering engine
// unchanged (WO-YYYY-MM-NNNNN), same configurable-prefix pattern as
// quotation_number_prefix/inquiry_number_prefix above. The engine's
// DEFAULT_PREFIXES fallback already resolves to "WO" if this row is ever
// missing; seeding it here just makes the configured value explicit and
// consistent with every other series.
const PHASE4_SYSTEM_SETTINGS: Array<{ key: string; value: string; valueType: "STRING"; description: string }> = [
  {
    key: "work_order_number_prefix",
    value: "WO",
    valueType: "STRING",
    description: "Configurable prefix for generated Work Order numbers (format PREFIX-YYYY-MM-NNNNN), same 5-digit numbering engine as quotations/inquiries — Phase 4 Step 2, D9.",
  },
];

// Phase 5 Step 2 — Service Report Intake permissions, matching the approved
// Phase 5 Baseline §03 Final RBAC Matrix / OD7 exactly. read_own's shape is
// deliberately narrower than Work Order's own read_own (D4, Phase 4) —
// status/processing visibility only, not full report content — but it is
// the same underlying mechanism: a permission the service layer filters by
// caller identity, not a UI-only restriction.
const PHASE5_PERMISSIONS: Array<{ module: string; action: string; description: string }> = [
  { module: "service_reports", action: "upload", description: "Upload a Service Report's original document and create its record (Technician: own only, enforced by uploaded_by = caller)" },
  { module: "service_reports", action: "read", description: "View any Service Report, full content" },
  { module: "service_reports", action: "read_assigned", description: "View reports linked to Work Orders assigned to the responsible Manager" },
  { module: "service_reports", action: "read_own", description: "View only the caller's own uploaded Service Reports, status/processing visibility only (Technician, backend-filtered)" },
  // Phase 5 Step 5 decision: verification authorization is role-based only.
  // An Office Staff/Manager/Admin-Owner holder of this permission may
  // verify a report even if they were the one who uploaded it — this
  // supersedes the original blueprint's row-level "verifier must not be
  // uploader" rule, which was never implemented (no verification endpoint
  // existed until Step 5). Technician structurally lacks this permission
  // regardless of who uploaded what.
  { module: "service_reports", action: "verify", description: "Review/correct staged extraction fields and mark VERIFIED — role-based only, not restricted by uploader identity" },
  { module: "service_reports", action: "document_approve", description: "Approve an original Service Report document without extracted fields — Admin/Owner only" },
  { module: "service_reports", action: "confirm", description: "Execute Confirm — populate canonical data from verified staging values (VERIFIED -> CONFIRMED)" },
  { module: "service_reports", action: "lock", description: "Final administrative lock (CONFIRMED -> LOCKED) — terminal, Manager/Admin-Owner only" },
];

// Admin/Owner and Manager: every Phase 5 permission (§03 — identical column
// for both roles, same pattern as every prior phase).
const ADMIN_MANAGER_PHASE5_GRANTS = [
  "service_reports.upload", "service_reports.read", "service_reports.verify",
  "service_reports.confirm", "service_reports.lock",
] as const;

// Office Staff: upload/read/verify/confirm — never lock (final sign-off is
// management-only, mirroring Work Order close's D2 precedent), and no
// Technician-only read_own.
const OFFICE_STAFF_PHASE5_GRANTS = [
  "service_reports.upload", "service_reports.read", "service_reports.verify", "service_reports.confirm",
] as const;

// Technician: upload (own only, app-enforced) and read_own only — no
// unscoped read, no verify/confirm/lock authority of any kind (OD6/OD7).
const TECHNICIAN_PHASE5_GRANTS = ["service_reports.upload", "service_reports.read_own"] as const;

// D9-style precedent (Phase 4) applied to Service Reports — SR-YYYY-MM-NNNNN
// via the existing 5-digit numbering engine, no engine change. The engine's
// DEFAULT_PREFIXES fallback already resolves to "SR" if this row is ever
// missing; seeding it here just makes the configured value explicit.
const PHASE5_SYSTEM_SETTINGS: Array<{ key: string; value: string; valueType: "STRING"; description: string }> = [
  {
    key: "service_report_number_prefix",
    value: "SR",
    valueType: "STRING",
    description: "Configurable prefix for generated Service Report numbers (format PREFIX-YYYY-MM-NNNNN), same 5-digit numbering engine as quotations/inquiries/work orders — Phase 5 Step 2.",
  },
];

// Step 1 correction round — unlike measurement_types/signoff_roles/
// measurement_stages/problem_types (all deliberately left unseeded, no
// approved list yet), service_report_types IS seeded here: a concrete
// initial list of three was explicitly approved, grounded in the three
// real Service Report forms reviewed. OTHER is the same universal
// catch-all convention as every other reference table in this schema.
const SERVICE_REPORT_TYPES: Array<{ code: string; label: string; sortOrder: number }> = [
  { code: "MAINTENANCE_CLEANING", label: "Maintenance / Cleaning", sortOrder: 0 },
  { code: "GENERAL_SERVICE_REPAIR", label: "General Service / Repair", sortOrder: 10 },
  { code: "INSTALLATION_COMMISSIONING", label: "Installation / Start-up / Testing & Commissioning", sortOrder: 20 },
  { code: "OTHER", label: "Other", sortOrder: 30 },
];

// Step 2 — approved starter lists for three of the four remaining Phase 5
// reference tables, grounded directly in the three real Service Report
// forms reviewed. measurement_types remains deliberately unseeded — its
// starter taxonomy is a Step 3 deliverable, informed by the extraction
// design work, not decided here.
const MEASUREMENT_STAGES: Array<{ code: string; label: string; sortOrder: number }> = [
  { code: "BEFORE_CLEANING", label: "Before Cleaning", sortOrder: 0 },
  { code: "AFTER_CLEANING", label: "After Cleaning", sortOrder: 10 },
  { code: "BEFORE_REPAIR", label: "Before Repair", sortOrder: 20 },
  { code: "AFTER_REPAIR", label: "After Repair", sortOrder: 30 },
  { code: "BEFORE_OPERATION", label: "Before Operation", sortOrder: 40 },
  { code: "DURING_OPERATION", label: "During Operation", sortOrder: 50 },
];

// From the General Service Report's fixed "Problem Reported" checkbox
// grid — labels kept close to the form's own wording.
const PROBLEM_TYPES: Array<{ code: string; label: string; sortOrder: number }> = [
  { code: "NOT_OPERATIONAL", label: "Not Operational", sortOrder: 0 },
  { code: "INSUFFICIENT_COOLING", label: "Insufficient Cooling", sortOrder: 10 },
  { code: "NOISY_OPERATION", label: "Noisy Operation", sortOrder: 20 },
  { code: "UNIT_ON_OFF_OPERATION", label: "Unit On/Off Operation", sortOrder: 30 },
  { code: "WATER_LEAKAGE", label: "Water Leakage", sortOrder: 40 },
  { code: "REFRIGERANT_LEAKAGE", label: "Refrigerant Leakage", sortOrder: 50 },
  { code: "OTHER", label: "Other", sortOrder: 60 },
];

// Deliberately kept separate per role, not consolidated (e.g. TECHNICIAN
// vs. FIELD_ENGINEER, CUSTOMER vs. CUSTOMER_REPRESENTATIVE) — explicit
// instruction: these represent different responsibilities across the real
// forms reviewed, even where the underlying person might be the same.
const SIGNOFF_ROLES: Array<{ code: string; label: string; sortOrder: number }> = [
  { code: "TECHNICIAN", label: "Technician", sortOrder: 0 },
  { code: "CUSTOMER", label: "Customer", sortOrder: 10 },
  { code: "FIELD_ENGINEER", label: "Field Engineer", sortOrder: 20 },
  { code: "INSTALLER_REPRESENTATIVE", label: "Installer Representative", sortOrder: 30 },
  { code: "CUSTOMER_REPRESENTATIVE", label: "Customer Representative", sortOrder: 40 },
  { code: "OTHER", label: "Other", sortOrder: 50 },
];

// Step 3 — the approved 33-type measurement taxonomy, derived from the
// three real Service Report forms reviewed (Maintenance Cleaning, General
// Service/Repair, Installation/Start-up/Testing & Commissioning). No
// OTHER catch-all here, deliberately — an OCR reading that can't be
// confidently mapped to one of these stays unresolved in staging for human
// verification rather than being silently classified away.
//
// PIPE_SIZE_LIQUID / PIPE_SIZE_GAS: the source form's own "S"/"D"
// abbreviations are NOT registered as aliases for these codes — their
// exact meaning on that form was never conclusively established. Raw "S"/
// "D" stay in extraction_measurements.field_name/ai_value exactly as
// printed; if extraction cannot confidently map a reading to
// PIPE_SIZE_LIQUID or PIPE_SIZE_GAS, it is left unresolved for a verifier,
// never guessed.
//
// No unit is stored on this table — measurement_types is a pure
// code/label classification. Units are never parsed or converted; every
// ServiceReportMeasurement.unit is preserved exactly as extracted. Two
// types (HEIGHT_DIFFERENCE, SUPERHEAT) have no unit printed on the source
// form at all and must never have one defaulted in during extraction.
const MEASUREMENT_TYPES: Array<{ code: string; label: string; sortOrder: number }> = [
  // Pressure
  { code: "LOW_SIDE_PRESSURE", label: "Low Side Pressure", sortOrder: 0 },
  { code: "HIGH_SIDE_PRESSURE", label: "High Side Pressure", sortOrder: 10 },
  // Electrical
  { code: "VOLTAGE", label: "Voltage", sortOrder: 20 },
  { code: "CURRENT", label: "Current", sortOrder: 30 },
  { code: "VOLTAGE_L1_L2", label: "Voltage (L1-L2)", sortOrder: 40 },
  { code: "VOLTAGE_L1_L3", label: "Voltage (L1-L3)", sortOrder: 50 },
  { code: "VOLTAGE_L2_L3", label: "Voltage (L2-L3)", sortOrder: 60 },
  { code: "CURRENT_L1", label: "Current (L1)", sortOrder: 70 },
  { code: "CURRENT_L2", label: "Current (L2)", sortOrder: 80 },
  { code: "CURRENT_L3", label: "Current (L3)", sortOrder: 90 },
  // Refrigerant line temperatures — kept fully separate, never merged
  { code: "SUCTION_PIPE_TEMPERATURE", label: "Suction Pipe Temperature", sortOrder: 100 },
  { code: "DISCHARGE_PIPE_TEMPERATURE", label: "Discharge Pipe Temperature", sortOrder: 110 },
  { code: "LIQUID_PIPE_TEMPERATURE", label: "Liquid Pipe Temperature", sortOrder: 120 },
  // Air temperatures
  { code: "INDOOR_RETURN_AIR_TEMPERATURE", label: "Indoor Return Air Temperature", sortOrder: 130 },
  { code: "INDOOR_SUPPLY_AIR_TEMPERATURE", label: "Indoor Supply Air Temperature", sortOrder: 140 },
  { code: "OUTDOOR_SUCTION_AIR_TEMPERATURE", label: "Outdoor Suction Air Temperature", sortOrder: 150 },
  { code: "OUTDOOR_DISCHARGE_AIR_TEMPERATURE", label: "Outdoor Discharge Air Temperature", sortOrder: 160 },
  { code: "ROOM_TEMPERATURE", label: "Room Temperature", sortOrder: 170 },
  { code: "AMBIENT_TEMPERATURE", label: "Ambient Temperature", sortOrder: 180 },
  // Installation/setup metrics
  { code: "PIPE_SIZE_LIQUID", label: "Liquid Pipe Size", sortOrder: 190 },
  { code: "PIPE_SIZE_GAS", label: "Gas Pipe Size", sortOrder: 200 },
  { code: "PIPING_LENGTH", label: "Piping Length", sortOrder: 210 },
  { code: "HEIGHT_DIFFERENCE", label: "Height Difference", sortOrder: 220 },
  { code: "WIRE_SIZE_CB_TO_ACCU", label: "Wire Size (C.B. to ACCU)", sortOrder: 230 },
  { code: "TRANSMISSION_WIRE_SIZE", label: "Transmission Wire Size", sortOrder: 240 },
  { code: "INSULATION_THICKNESS_LIQUID", label: "Insulation Thickness (Liquid)", sortOrder: 250 },
  { code: "INSULATION_THICKNESS_GAS", label: "Insulation Thickness (Gas)", sortOrder: 260 },
  // Capacity
  { code: "BREAKER_CAPACITY", label: "Breaker Capacity", sortOrder: 270 },
  // Operational/test
  { code: "THERMOSTAT_SETTING", label: "Thermostat Setting", sortOrder: 280 },
  { code: "RUN_TESTING_DURATION", label: "Run Testing Duration", sortOrder: 290 },
  { code: "REFRIGERANT_CHARGE", label: "Additional Refrigerant Charge", sortOrder: 300 },
  { code: "SUPERHEAT", label: "Superheat", sortOrder: 310 },
  // Condition
  { code: "INSTALLATION_CONDITION", label: "Installation Condition", sortOrder: 320 },
  // Phase 5 Step 6 (Confirm) — approved Decision 1: a deterministic,
  // always-available fallback for a verified measurement whose staging
  // suggestedMeasurementTypeCode was null/unresolvable. measurementTypeCode
  // on service_report_measurements is NOT NULL, so Confirm must always be
  // able to resolve to *some* real code — this is that code. Deliberately
  // never suggested by the extraction pipeline itself (it is not listed in
  // the approved-codes prompt context, so the model can never emit it) —
  // it exists solely as Confirm's own last-resort target, sorted to the
  // very end so it never appears near real measurement types in any
  // alphabetically- or sortOrder-sorted UI list.
  { code: "OTHER_UNMAPPED", label: "Other / Unmapped", sortOrder: 9999 },
];

async function main() {
  console.log("Seeding roles...");
  const roles = new Map<string, { id: string }>();
  for (const name of ROLE_NAMES) {
    const role = await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name, isSystem: true },
    });
    roles.set(name, role);
  }

  console.log("Seeding permissions...");
  const permissions = new Map<string, { id: string }>();
  for (const p of PHASE1_PERMISSIONS) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module: p.module, action: p.action } },
      update: { description: p.description },
      create: p,
    });
    permissions.set(`${p.module}.${p.action}`, permission);
  }

  console.log("Granting Admin/Owner all Phase 1 permissions...");
  const adminOwner = roles.get("Admin/Owner")!;
  for (const permission of permissions.values()) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: adminOwner.id, permissionId: permission.id } },
      update: {},
      create: { roleId: adminOwner.id, permissionId: permission.id },
    });
  }

  console.log("Granting Manager read access to the audit log...");
  const manager = roles.get("Manager")!;
  const auditRead = permissions.get("audit_logs.read")!;
  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId: manager.id, permissionId: auditRead.id } },
    update: {},
    create: { roleId: manager.id, permissionId: auditRead.id },
  });

  console.log("Seeding Phase 2 permissions...");
  const phase2Permissions = new Map<string, { id: string }>();
  for (const p of PHASE2_PERMISSIONS) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module: p.module, action: p.action } },
      update: { description: p.description },
      create: p,
    });
    phase2Permissions.set(`${p.module}.${p.action}`, permission);
  }

  console.log("Granting Admin/Owner all Phase 2 permissions...");
  for (const permission of phase2Permissions.values()) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: adminOwner.id, permissionId: permission.id } },
      update: {},
      create: { roleId: adminOwner.id, permissionId: permission.id },
    });
  }

  console.log("Granting Manager its reduced Phase 2 permission set (RBAC correction — read-only; routine record maintenance belongs to Office Staff)...");
  for (const key of MANAGER_PHASE2_GRANTS) {
    const permission = phase2Permissions.get(key)!;
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: manager.id, permissionId: permission.id } },
      update: {},
      create: { roleId: manager.id, permissionId: permission.id },
    });
  }

  console.log("Granting Office Staff its reduced Phase 2 permission set (no deactivate, no delete, no reference-table manage)...");
  const officeStaff = roles.get("Office Staff")!;
  for (const key of OFFICE_STAFF_PHASE2_GRANTS) {
    const permission = phase2Permissions.get(key)!;
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: officeStaff.id, permissionId: permission.id } },
      update: {},
      create: { roleId: officeStaff.id, permissionId: permission.id },
    });
  }

  console.log("Technician: intentionally granted nothing for Phase 2 (approved Decision 2 — deferred to Phase 4's work-order-scoped access).");

  console.log("Seeding Phase 3 permissions...");
  const phase3Permissions = new Map<string, { id: string }>();
  for (const p of PHASE3_PERMISSIONS) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module: p.module, action: p.action } },
      update: { description: p.description },
      create: p,
    });
    phase3Permissions.set(`${p.module}.${p.action}`, permission);
  }

  console.log("Seeding Step 4 reference-table permissions (inquiry_sources, inquiry_types)...");
  for (const p of PHASE3_STEP4_REFERENCE_PERMISSIONS) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module: p.module, action: p.action } },
      update: { description: p.description },
      create: p,
    });
    // Same map as the rest of Phase 3 — folded in here so the Admin/Owner +
    // Manager "grant everything" loop and Office Staff's reduced-grant
    // lookup below both pick these up without a separate grant pass.
    phase3Permissions.set(`${p.module}.${p.action}`, permission);
  }

  console.log("Granting Admin/Owner all Phase 3 permissions...");
  for (const permission of phase3Permissions.values()) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: adminOwner.id, permissionId: permission.id } },
      update: {},
      create: { roleId: adminOwner.id, permissionId: permission.id },
    });
  }

  console.log("Granting Manager its reduced Phase 3 permission set (RBAC correction — read + approve/reject retained; create/update and reference-table manage removed)...");
  for (const key of MANAGER_PHASE3_GRANTS) {
    const permission = phase3Permissions.get(key)!;
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: manager.id, permissionId: permission.id } },
      update: {},
      create: { roleId: manager.id, permissionId: permission.id },
    });
  }

  console.log("Granting Office Staff its reduced Phase 3 permission set (no approve/reject, no reference-table manage)...");
  for (const key of OFFICE_STAFF_PHASE3_GRANTS) {
    const permission = phase3Permissions.get(key)!;
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: officeStaff.id, permissionId: permission.id } },
      update: {},
      create: { roleId: officeStaff.id, permissionId: permission.id },
    });
  }

  console.log("Technician: intentionally granted nothing for Phase 3 (same deferred-access decision as Phase 2).");

  console.log("Seeding Phase 3 Step 3 (Inquiries) permissions...");
  const inquiriesPermissions = new Map<string, { id: string }>();
  for (const p of PHASE3_INQUIRIES_PERMISSIONS) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module: p.module, action: p.action } },
      update: { description: p.description },
      create: p,
    });
    inquiriesPermissions.set(`${p.module}.${p.action}`, permission);
  }

  console.log("Granting Admin/Owner and Office Staff all Inquiries permissions (full/full per §11)...");
  for (const roleName of ["Admin/Owner", "Office Staff"] as const) {
    const role = roles.get(roleName)!;
    for (const permission of inquiriesPermissions.values()) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  console.log("Granting Manager its reduced Inquiries permission set (RBAC correction — read-only; routine inquiry handling belongs to Office Staff)...");
  for (const key of MANAGER_INQUIRIES_GRANTS) {
    const permission = inquiriesPermissions.get(key)!;
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: manager.id, permissionId: permission.id } },
      update: {},
      create: { roleId: manager.id, permissionId: permission.id },
    });
  }

  console.log("Technician: intentionally granted nothing for Inquiries (same deferred-access decision as elsewhere in Phase 2/3).");

  console.log("Seeding Phase 4 Step 2 (Work Orders) permissions...");
  const phase4Permissions = new Map<string, { id: string }>();
  for (const p of PHASE4_PERMISSIONS) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module: p.module, action: p.action } },
      update: { description: p.description },
      create: p,
    });
    phase4Permissions.set(`${p.module}.${p.action}`, permission);
  }

  console.log("Granting Admin/Owner and Manager their Phase 4 permission set (all except read_own/start_own)...");
  for (const roleName of ["Admin/Owner", "Manager"] as const) {
    const role = roles.get(roleName)!;
    for (const originalKey of ADMIN_MANAGER_PHASE4_GRANTS) {
      const key = roleName === "Manager" && originalKey === "work_orders.read" ? "work_orders.read_assigned" : originalKey;
      const permission = phase4Permissions.get(key)!;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  console.log("Granting Office Staff its Phase 4 permission set (no close, no final cancel, no Technician-only actions)...");
  for (const key of OFFICE_STAFF_PHASE4_GRANTS) {
    const permission = phase4Permissions.get(key)!;
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: officeStaff.id, permissionId: permission.id } },
      update: {},
      create: { roleId: officeStaff.id, permissionId: permission.id },
    });
  }

  console.log("Granting Technician its Phase 4 permission set: read_own, start_own, and field_complete_own (D4/D6, RBAC correction)...");
  const technician = roles.get("Technician")!;
  for (const key of TECHNICIAN_PHASE4_GRANTS) {
    const permission = phase4Permissions.get(key)!;
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: technician.id, permissionId: permission.id } },
      update: {},
      create: { roleId: technician.id, permissionId: permission.id },
    });
  }

  console.log("Seeding Phase 4 system settings (work_order_number_prefix)...");
  for (const s of PHASE4_SYSTEM_SETTINGS) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      update: {},
      create: s,
    });
  }

  console.log("Seeding Phase 5 Step 2 (Service Reports) permissions...");
  const phase5Permissions = new Map<string, { id: string }>();
  for (const p of PHASE5_PERMISSIONS) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module: p.module, action: p.action } },
      update: { description: p.description },
      create: p,
    });
    phase5Permissions.set(`${p.module}.${p.action}`, permission);
  }

  console.log("Granting Admin/Owner and Manager their Phase 5 permission set (all five, including lock)...");
  for (const roleName of ["Admin/Owner", "Manager"] as const) {
    const role = roles.get(roleName)!;
    for (const originalKey of ADMIN_MANAGER_PHASE5_GRANTS) {
      const key = roleName === "Manager" && originalKey === "service_reports.read" ? "service_reports.read_assigned" : originalKey;
      const permission = phase5Permissions.get(key)!;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  console.log("Granting Office Staff its Phase 5 permission set (no lock, no Technician-only read_own)...");
  const documentApprovalPermission = phase5Permissions.get("service_reports.document_approve")!;
  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId: roles.get("Admin/Owner")!.id, permissionId: documentApprovalPermission.id } },
    update: {},
    create: { roleId: roles.get("Admin/Owner")!.id, permissionId: documentApprovalPermission.id },
  });
  for (const key of OFFICE_STAFF_PHASE5_GRANTS) {
    const permission = phase5Permissions.get(key)!;
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: officeStaff.id, permissionId: permission.id } },
      update: {},
      create: { roleId: officeStaff.id, permissionId: permission.id },
    });
  }

  console.log("Granting Technician its Phase 5 permission set: upload (own) and read_own only (OD6/OD7)...");
  for (const key of TECHNICIAN_PHASE5_GRANTS) {
    const permission = phase5Permissions.get(key)!;
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: technician.id, permissionId: permission.id } },
      update: {},
      create: { roleId: technician.id, permissionId: permission.id },
    });
  }

  console.log("Seeding Phase 5 system settings (service_report_number_prefix)...");
  for (const s of PHASE5_SYSTEM_SETTINGS) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      update: {},
      create: s,
    });
  }

  console.log("Seeding Phase 5 Step 1 correction round: service_report_types (explicitly approved initial list)...");
  for (const t of SERVICE_REPORT_TYPES) {
    await prisma.serviceReportType.upsert({
      where: { code: t.code },
      update: { label: t.label, sortOrder: t.sortOrder },
      create: t,
    });
  }

  console.log("Seeding Phase 5 Step 2: measurement_stages, problem_types, signoff_roles (approved starter lists)...");
  for (const s of MEASUREMENT_STAGES) {
    await prisma.measurementStage.upsert({
      where: { code: s.code },
      update: { label: s.label, sortOrder: s.sortOrder },
      create: s,
    });
  }
  for (const p of PROBLEM_TYPES) {
    await prisma.problemType.upsert({
      where: { code: p.code },
      update: { label: p.label, sortOrder: p.sortOrder },
      create: p,
    });
  }
  for (const r of SIGNOFF_ROLES) {
    await prisma.signoffRole.upsert({
      where: { code: r.code },
      update: { label: r.label, sortOrder: r.sortOrder },
      create: r,
    });
  }

  console.log("Seeding Phase 5 Step 3: measurement_types (approved 33-type taxonomy)...");
  for (const m of MEASUREMENT_TYPES) {
    await prisma.measurementType.upsert({
      where: { code: m.code },
      update: { label: m.label, sortOrder: m.sortOrder },
      create: m,
    });
  }

  console.log("Seeding capacity units...");
  for (const c of CAPACITY_UNITS) {
    await prisma.capacityUnit.upsert({
      where: { code: c.code },
      update: { label: c.label, sortOrder: c.sortOrder },
      create: c,
    });
  }

  console.log("Seeding equipment types...");
  for (const t of EQUIPMENT_TYPES) {
    await prisma.equipmentType.upsert({
      where: { code: t.code },
      update: { label: t.label, sortOrder: t.sortOrder },
      create: t,
    });
  }

  console.log("Seeding equipment system types...");
  for (const t of EQUIPMENT_SYSTEM_TYPES) {
    await prisma.equipmentSystemType.upsert({
      where: { code: t.code },
      update: { label: t.label, sortOrder: t.sortOrder },
      create: t,
    });
  }

  console.log("Seeding system settings...");
  for (const s of SYSTEM_SETTINGS) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      update: {},
      create: s,
    });
  }

  console.log("Seeding trades...");
  for (const t of TRADES) {
    await prisma.trade.upsert({
      where: { code: t.code },
      update: { label: t.label, sortOrder: t.sortOrder },
      create: t,
    });
  }

  console.log("Seeding inquiry sources (Step 3 correction)...");
  for (const s of INQUIRY_SOURCES) {
    await prisma.inquirySource.upsert({
      where: { code: s.code },
      update: { label: s.label, sortOrder: s.sortOrder },
      create: s,
    });
  }

  console.log("inquiry_types: intentionally NOT seeded — no approved initial list yet (Step 3 correction report).");

  console.log("Seeding starter quotation term template (PLACEHOLDER body — see the constant's comment above)...");
  await prisma.quotationTermTemplate.upsert({
    where: { id: DEFAULT_QUOTATION_TERM_TEMPLATE_ID },
    update: { body: DEFAULT_QUOTATION_TERM_TEMPLATE_BODY },
    create: {
      id: DEFAULT_QUOTATION_TERM_TEMPLATE_ID,
      name: "Default Terms & Conditions (PLACEHOLDER)",
      quotationType: null,
      tradeCode: null,
      body: DEFAULT_QUOTATION_TERM_TEMPLATE_BODY,
      isDefault: true,
    },
  });

  console.log("Seeding Phase 3 system settings...");
  for (const s of PHASE3_SYSTEM_SETTINGS) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      update: {},
      create: s,
    });
  }

  console.log("Seeding the bootstrap Admin/Owner user...");
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const fullName = process.env.SEED_ADMIN_NAME ?? "AgileWorks Owner";

  if (!email || !password) {
    throw new Error(
      "SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set (see .env.example) — no hard-coded credential is ever seeded.",
    );
  }

  const passwordHash = await argon2.hash(password);
  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { fullName, email, passwordHash, status: "ACTIVE" },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: adminOwner.id } },
    update: {},
    create: { userId: admin.id, roleId: adminOwner.id },
  });

  await prisma.auditLog.create({
    data: {
      actorType: ActorType.SYSTEM,
      actorUserId: null,
      action: "seed",
      entityType: "user",
      entityId: admin.id,
      afterData: { email, fullName, roles: ["Admin/Owner"] },
    },
  });

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
