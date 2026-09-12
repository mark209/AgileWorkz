# Management Dashboard KPIs — Approved Requirement & Schema Audit

**Status: APPROVED POST-V1/V1.1 REQUIREMENT — DOCUMENTATION ONLY.** No
production code, Prisma schema, migration, API, dashboard UI, or deployment
configuration has been changed for this requirement. This document records
what was requested, audits it against the current schema exactly as it
exists today, and recommends a V1/V1.1 split. **Implementation requires a
separate, explicit approval** and does not begin from this document alone.

This is unrelated to, and does not pause or interrupt, the in-progress
Phase 7 production deployment/backup work — see the end of this document
for the return point.

---

## 1. The requirement, as approved

A management dashboard organized as:

**Commercial Funnel:** Quoted → Won/Approved → Work Orders → Completed → Billed → Collected
**Then:** Operations | Service Quality | Receivables | Profitability sections
**Filters:** Monthly / Quarterly / Yearly period, and (where architecturally compatible) customer/project
**Chart:** a 12-month trend line for Quoted, Won, Billed, Collected
**Currency:** Philippine Peso (₱), with counts/percentages alongside financial values
**Drill-down:** from a KPI into its underlying Work Orders/Service Reports, where appropriate

29 specific KPIs were requested across four groups (Primary, Operational, Service Quality/Profitability). Each is audited individually below.

---

## 2. How the audit was performed

Every model and enum in [`prisma/schema.prisma`](../../prisma/schema.prisma) was inspected directly (not inferred from memory or documentation) — specifically `Quotation`, `QuotationRevision`, `WorkOrder`, `WorkOrderActualCost`, `ServiceReport`, and a full-schema search for any Invoice/Payment/Billing/Receivable model, of which **none exist**. Every KPI below is mapped to the actual field names as they exist in the schema today.

---

## 3. Section A — Primary Management KPIs

| # | KPI | Source table(s) | Amount field | Date field | Status filter | Formula | Support |
|---|---|---|---|---|---|---|---|
| A1 | Quotation Submitted | `quotation_revisions` | `total_amount` | `submitted_at` **or** `sent_at` — see §6.1 | any (count all revisions reaching this milestone) | `SUM(total_amount)`, `COUNT(*)` | **Supported**, pending one date-semantics decision (§6.1) |
| A2 | Quotation Won/Approved | `quotation_revisions` | `total_amount` | `customer_decision_at` (recommended — see §6.2) | `status = ACCEPTED` | `SUM(total_amount)`, `COUNT(*)` | **Supported**, pending one label clarification (§6.2) — the schema's own `APPROVED` status is an *internal* sign-off, not the customer's acceptance |
| A3 | Quotation Conversion Rate | derived from A1 + A2 | — | — | — | `A2 count ÷ A1 count × 100` (or value-weighted) | **Supported** once A1/A2 are resolved |
| A4 | Work Orders Proceeded | `work_orders` (+ `quotation_revisions` for value) | `quotation_revision.total_amount` (linked WOs) or `estimated_value` (standalone) | `created_at` — no dedicated "authorized" timestamp exists (§6.3) | any | `SUM(value)`, `COUNT(*)` | **Partially supported** — value is missing entirely for standalone Work Orders whose `estimated_value` was never entered (it is optional, "no threshold logic reads it") |
| A5 | Work Orders Completed | `work_orders` | same as A4 | `completed_at` | `status = COMPLETED` (or also `CLOSED`? — see §6.4) | `SUM(value)`, `COUNT(*)` | **Partially supported**, same value gap as A4 |
| A6 | Billed Amount | *(no model)* | — | — | — | — | **Not supported** — no Invoice/Billing model exists anywhere in the schema |
| A7 | Collected Amount | *(no model)* | — | — | — | — | **Not supported** — no Payment/Collections model exists |
| A8 | Accounts Receivable | *(no model)* | — | — | — | `A6 − A7` | **Not supported** — depends entirely on A6 and A7 |
| A9 | Backlog / Remaining Contract Value | `quotation_revisions` + `work_orders` | `total_amount` less completed/billed portion | — | `status = ACCEPTED`, WO `status ≠ COMPLETED` | See §6.5 for the exact definition this needs | **Partially supported** — the "uncompleted approved value" half is computable; the "unbilled" half needs A6 |

---

## 4. Section B — Operational KPIs

| # | KPI | Source table(s) | Date field | Status filter | Formula | Support |
|---|---|---|---|---|---|---|
| B1 | Open Work Orders | `work_orders` | — | `status NOT IN (COMPLETED, CLOSED, CANCELLED)` | `COUNT(*)` | **Supported** |
| B2 | Work Orders Completed | `work_orders` | `completed_at` | `status = COMPLETED` | `COUNT(*)` | **Supported** (same as A5's count half) |
| B3 | Overdue Work Orders | `work_orders` | `scheduled_date` | `scheduled_date < today AND status NOT IN (COMPLETED, CLOSED, CANCELLED)` | `COUNT(*)` | **Supported** |
| B4 | Average Work Order Completion Time | `work_orders` | `created_at`, `completed_at` (or `started_at`) | `status = COMPLETED` | `AVG(completed_at − created_at)` | **Supported** — one decision needed: measure from creation or from technician start (§6.6) |
| B5 | Preventive Maintenance Due | `work_orders` joined to `quotations.quotation_type = PREVENTIVE_MAINTENANCE` via `quotation_revision` | `scheduled_date` | `status ≠ COMPLETED`, `scheduled_date` in/approaching period | `COUNT(*)` | **Supported** — relies on the existing `generate_maintenance_visits` feature actually being used to create these Work Orders |
| B6 | Preventive Maintenance Completed | same join as B5 | `completed_at` | `status = COMPLETED` | `COUNT(*)` | **Supported**, same basis as B5 |
| B7 | Callback / Repeat Repair Rate | `work_orders.standalone_reason_type = CALLBACK` or `service_reports.source_type = CALLBACK_VISIT` | — | self-declared flag only | `COUNT(flagged) ÷ COUNT(completed) × 100` | **Partially supported** — only as a self-declared classification; there is no structural link from a callback back to the original visit it followed, so a true "repeat within N days for the same equipment" rate cannot be computed today (§6.7) |
| B8 | First-Time Fix Rate | *(same gap as B7)* | — | — | `1 − callback rate`, typically | **Not supported** — depends on the same missing visit-to-visit linkage as B7 |
| B9 | Service Reports Pending Verification | `service_reports` | `uploaded_at` | `status = PENDING_VERIFICATION` | `COUNT(*)` | **Supported** |
| B10 | Service Reports Completed/Verified | `service_reports` | `verified_at` (or `confirmed_at`/`locked_at` for a stricter definition) | `status IN (VERIFIED, CONFIRMED, LOCKED)` | `COUNT(*)` | **Supported** |

Drill-down from any B-series KPI into its underlying `work_orders`/`service_reports` rows is straightforward — every KPI above is already a filtered query over one of those two tables, so the same filter that produces the count can produce the row list.

---

## 5. Section C — Profitability KPIs

| # | KPI | Source table(s) | Field | Support |
|---|---|---|---|---|
| C1 | Revenue | `quotation_revisions.total_amount` (linked to completed/billed Work Orders) | `total_amount` | **Supported** as "quoted/contract revenue"; **not supported** as "recognized/billed revenue" until Billing exists |
| C2 | Direct Material Cost | `work_order_actual_costs` where `cost_type = MATERIAL` | `amount` | **Schema exists, data does not** — see §6.8 |
| C3 | Direct Labor Cost | `work_order_actual_costs` where `cost_type = LABOR` | `amount` | **Schema exists, data does not** |
| C4 | Subcontractor Cost | `work_order_actual_costs` where `cost_type = SUBCONTRACTOR` | `amount` | **Schema exists, data does not** |
| C5 | Other Direct Job Cost | `work_order_actual_costs` where `cost_type IN (MOBILIZATION, EQUIPMENT_RENTAL, OTHER)` | `amount` | **Schema exists, data does not** |
| C6 | Total Direct Job Cost | `SUM` of C2–C5 | — | Same as above |
| C7 | Gross Profit | `C1 − C6` | `work_orders.actual_gross_profit_amount` (column already exists, "unpopulated by any Phase 4 workflow") | **Schema exists, data does not** |
| C8 | Gross Margin % | `C7 ÷ C1 × 100` | `work_orders.actual_gross_margin_percent` (column already exists, same status) | **Schema exists, data does not** |

**The important nuance here, stated plainly:** this is *not* a missing-schema problem the way Billing/Payments is. `WorkOrderActualCost` and its `WorkOrderCostType` enum (`LABOR`, `MATERIAL`, `MOBILIZATION`, `SUBCONTRACTOR`, `EQUIPMENT_RENTAL`, `OVERHEAD`, `OTHER`) already match the requested cost breakdown exactly, and `WorkOrder` already carries `actualTotalCost`/`actualGrossProfitAmount`/`actualGrossMarginPercent` columns. The schema's own comment is explicit: *"this table exists in Phase 4; no create/update endpoint reads or writes it yet."* **There is currently no way for any user to enter a cost against a Work Order at all.** Profitability reporting is blocked on a data-entry workflow (a real feature: a screen/API to record costs), not a schema redesign.

Per your explicit instruction, none of C1–C8 should be estimated, inferred, or backfilled from unrelated fields to populate the dashboard early — they should show as genuinely unavailable until real cost data exists.

---

## 6. Data-integrity findings requiring a decision before implementation

These are not blockers to documenting the requirement, but they need an explicit answer from you before any KPI touching them is built, per your own instruction to get date semantics right.

1. **"Submitted" is ambiguous against the schema.** `QuotationRevision` has *two* distinct timestamps that could both plausibly mean "submitted": `submittedAt` (moving out of `DRAFT`, i.e. submitted for *internal* approval) and `sentAt` (sent to the *customer*). Which one A1 means changes the KPI materially. **Needs your decision.**
2. **"Approved" and "Won" are two different things in this schema, not one.** `APPROVED` is an internal, threshold-gated manager sign-off that happens *before* a quotation is sent — it is not the customer agreeing to anything. `ACCEPTED` (with its own `customerDecisionAt` timestamp) is the customer's actual yes. For a *commercial funnel* KPI ("Won"), `ACCEPTED`/`customerDecisionAt` is almost certainly the correct mapping — recommending this, but flagging it since your requirement's label ("Won/Approved") could be read either way.
3. **"Proceeded/authorized" has no dedicated timestamp.** `WorkOrder` has `createdAt`, `startedAt` (technician's own start), `completedAt`, `closedAt` — but no distinct "authorized to proceed" event. For a Work Order created `FROM_QUOTATION`, `createdAt` effectively *is* the proceed decision (a WO isn't created until someone decides to open one) and is a reasonable proxy — but it's not a dedicated field, and if a future workflow ever separates "WO created as a placeholder" from "WO authorized to start," this proxy would break. **Recommend accepting `createdAt` as the proxy for V1**, revisit if that separation is ever introduced.
4. **Should "Completed" work orders include `CLOSED` ones?** `COMPLETED` (field work finished) and `CLOSED` (final management sign-off) are deliberately distinct states in this schema. A `CLOSED` work order was, by definition, `COMPLETED` first. Recommend counting `status IN (COMPLETED, CLOSED)` for A5/B2 so a closed order doesn't disappear from the "completed" KPI — **needs your confirmation**.
5. **Backlog's exact formula needs to be fixed in writing before it's built**, per your own instruction to use "a clearly documented business definition." Recommend: *Backlog = SUM(accepted quotation revision totals) − SUM(billed amount for Work Orders traced to those revisions)* once Billing exists; an interim V1 proxy (clearly labeled as such) could use *SUM(accepted value) − SUM(value of completed Work Orders)*, which conflates "unbilled" with "uncompleted" and should never be presented as the real Backlog figure without that label.
6. **Completion-time basis**: measuring from `createdAt` (includes scheduling delay) vs. `startedAt` (pure field-work duration) produces very different numbers. **Needs your decision.**
7. **Callback/repeat-visit detection has no structural basis today** — only a self-declared classification a technician or office staff chooses at creation time, not a computed link back to an original visit. A trustworthy rate needs either (a) a new nullable self-referencing field (e.g. `WorkOrder.relatedWorkOrderId`) explicitly linking a callback to the visit it follows, or (b) an agreed heuristic (e.g. "any Work Order at the same site + same equipment/system within N days of a prior Completed one"), which is buildable without a schema change but is an approximation, not a fact the system actually records.
8. **Historical reproducibility — good news, one thing to watch.** `QuotationRevision` is explicitly "immutable once it leaves DRAFT," and its amounts/dates are frozen at that point — a past quotation's numbers in the dashboard will not silently change later, which is exactly the reproducibility property you asked for. The one thing to design carefully *when* the costing/billing workflow is eventually built: if `actualGrossProfitAmount`/`actualGrossMarginPercent` are ever computed as a *live* rollup rather than a value frozen at a specific business event (e.g. at Work Order close), a past month's profitability could retroactively change if someone edits a cost entry later. Worth deciding the freeze point at that time — not an issue today since the columns are always empty.

---

## 7. Minimum additional data model required

| Gap | Minimum addition (not implemented — for future approval) |
|---|---|
| Billing/Invoices (blocks A6, A8, A9's full definition, C1 as recognized revenue) | A new `Invoice` model: customer/work-order or quotation link, invoice number, invoice date, amount, status (e.g. draft/sent/paid/void) |
| Collections/Payments (blocks A7, A8) | A new `Payment` (or `Receipt`) model: link to `Invoice`, amount, payment date, method |
| Accounts Receivable (A8) | Purely derived from the two models above — no separate table needed |
| Job costing data entry (blocks C2–C8) | **No schema change** — `WorkOrderActualCost` already has the right shape. What's missing is a real feature: an API + UI screen letting authorized staff record a cost line against a Work Order, and a job that rolls those lines up into `WorkOrder.actualTotalCost`/`actualGrossProfitAmount`/`actualGrossMarginPercent` |
| Callback/repeat-visit tracking (B7, B8) | A nullable `WorkOrder.relatedWorkOrderId` self-reference (minimum), or an agreed time/site/equipment heuristic (no schema change, lower precision) |
| Work Order "proceeded" date (A4) | Optional: a dedicated `authorizedAt` timestamp, if `createdAt` is ever judged an insufficient proxy (§6.3) |

---

## 8. Recommended V1 / V1.1 split

### Safe for V1 now — fully or well supported, computation only, no schema change

- A1 Quotation Submitted, A2 Won/Approved, A3 Conversion Rate *(pending the two date-semantics decisions in §6.1–6.2)*
- A4 Work Orders Proceeded, A5 Work Orders Completed *(value will legitimately show as incomplete for any standalone Work Order missing an entered estimate — this should be visible, not hidden)*
- B1 Open Work Orders, B2 Work Orders Completed, B3 Overdue Work Orders, B4 Average Completion Time
- B5 Preventive Maintenance Due, B6 Preventive Maintenance Completed
- B9 Service Reports Pending Verification, B10 Service Reports Completed/Verified
- Monthly/Quarterly/Yearly period filters, customer/project filters, and KPI-to-record drill-down — all architecturally trivial given every core table already carries the needed date and `customerId`/`siteId` fields
- The 12-month trend chart, **for Quoted and Won only** (Billed/Collected must wait — see below)
- The Commercial Funnel visualization, **showing only its first four stages** (Quoted → Won → Work Orders → Completed); the Billed/Collected stages should be visibly marked "coming in V1.1," not silently omitted or zero-filled

### V1.1 — genuinely blocked on new data, not just new UI

- A6 Billed Amount, A7 Collected Amount, A8 Accounts Receivable, and A9 Backlog's *full* definition — all require the new Invoice/Payment models
- All of Section C (Profitability) — requires the job-costing data-entry workflow to actually exist and be used first; the schema is ready, the feature isn't
- B7 Callback/Repeat Repair Rate and B8 First-Time Fix Rate — require either the relational link or an explicitly agreed heuristic, which should be decided deliberately rather than shipped as a guess
- The full 6-stage Commercial Funnel and the Billed/Collected lines of the trend chart

---

## Explicit guardrails honored in this document

- No production code, Prisma schema, migration, API, dashboard UI, or deployment configuration was modified.
- No KPI was estimated, inferred, or backfilled from unrelated fields.
- This is a documentation-and-audit deliverable only, awaiting your explicit approval before any implementation begins.

---

## Returning to Phase 7

This concludes the dashboard requirement documentation. **Resuming exactly where the Phase 7 backup workstream left off:** prerequisite #4 (`infra/backup/`) — the `Dockerfile` is already written to disk (uncommitted); the revised `backup.sh` (with the trap-based cleanup, deterministic `jq`-based verification, distinct heartbeat-failure handling, and no-secrets-on-argv changes) was reviewed but is **not yet written**, pending your confirmation from the message before this one.
