# UI/UX Audit

**Audit date:** 2026-10-11  
**Surfaces:** Office Next.js application (`apps/web`) and technician field application (`apps/field`)  
**Verification:** Source review and production builds. Both apps returned HTTP 200 for `/login`; visual screenshots, viewport interaction, and authenticated business screens could not be inspected because the available browser automation runtimes failed to initialize (`failed to write kernel assets: The system cannot find the path specified`). No browser dependency was installed. The app has no local database or seeded account, so the authenticated flows were not available.

## Overall assessment

The office app uses a consistent Tailwind/shadcn-style component set, shared page headers, breadcrumbs, state components, status badges, and permission-gated actions. Customer, quotation, work-order, and service-report screens are separated into route-level components. The technician app provides job list/detail, lifecycle actions, and service-report upload with smaller mobile-oriented components. Existing loading, error, and empty states are a strength.

The audit found no basis for a redesign. The most useful improvements are better keyboard interaction, scalable list/search flows, quicker dashboard loading, and a modest convergence of the office and field visual patterns. Recommendations that depend on visual screenshots remain provisional.

## Findings

### UX-001 — Customer rows are mouse-clickable but not keyboard-operable links

- **Screen/component:** Office app, Customers list (`apps/web/src/app/customers/page.tsx:113-119`)
- **Problem:** A table row uses `onClick` and a pointer cursor to navigate, but the row is not a link or button and has no keyboard focus/activation semantics.
- **User impact:** Keyboard-only users and assistive-technology users may not discover or open customer records. This also makes the interactive row’s purpose less obvious to browser tooling.
- **Recommendation:** Put a real `<Link>` in the customer-name cell or make the row fully keyboard accessible with focus, semantics, and Enter/Space handling. Keep the whole-row pointer affordance only if the accessible target remains clear.
- **Priority:** P1 accessibility/usability; **complexity:** Low.
- **Verification status:** Confirmed by source review; not checked in a browser.

### UX-002 — Customer search is local, limited, and tied to an unbounded list request

- **Screen/component:** Office app, Customers list and API (`apps/web/src/app/customers/page.tsx:28-59`, `apps/api/src/modules/customers/customers.service.ts:24`)
- **Problem:** The page fetches every customer and filters only name, email, and phone in the browser. There is no server-side search, pagination, sorting, or filtering by status/customer type in this list.
- **User impact:** It is straightforward for a small customer base, but response time, transfer size, and local filtering work grow with the whole customer table. Staff cannot narrow the list by other useful identifiers or sort it by status/type.
- **Recommendation:** Add server-side query parameters for search/status/type and bounded pagination, preserving the current three-field search as the default. Add clear no-results and paging states.
- **Priority:** P2; **complexity:** Medium; backend/API work required.
- **Verification status:** Confirmed by source review; performance impact is a growth risk, not a measured slowdown.

### UX-003 — Dashboard waits on permitted sections serially

- **Screen/component:** Office dashboard (`apps/web/src/app/dashboard/page.tsx:68-107`)
- **Problem:** The `load()` callback awaits customer, service-report, quotation, and work-order requests in sequence. Each section handles its own failure, which is useful, but independent requests add their network times together.
- **User impact:** Users with several dashboard permissions may wait through multiple round trips before seeing later sections. This becomes more noticeable on slower office/mobile links.
- **Recommendation:** Start permitted reads concurrently with `Promise.allSettled`, then update each section independently. Add cancellation or stale-response handling if users can switch accounts/routes during a load.
- **Priority:** P2; **complexity:** Low/Medium.
- **Verification status:** Sequential order confirmed in source; runtime latency not measured.

### UX-004 — Office and field apps have different UI construction patterns

- **Screen/component:** Field pages/components use inline style objects (`apps/field/src/lib/styles.ts`, `apps/field/src/app/home/page.tsx`); office app uses Tailwind tokens and shared UI components (`apps/web/src/components/ui`, `apps/web/src/app/globals.css`)
- **Problem:** Buttons, spacing, typography, and state presentation are authored through separate patterns. This is a consistency/maintenance concern; the field app may reasonably keep a denser touch-first layout.
- **User impact:** Employees moving between office and field screens may see different visual conventions; future shared behaviors may need parallel fixes.
- **Recommendation:** Agree a small shared set of colors, status labels, button semantics, focus states, and spacing rules. Keep layouts specific to each device and workflow; do not force a broad redesign.
- **Priority:** P2; **complexity:** Medium.
- **Verification status:** Confirmed from source. Visual mismatch magnitude is not confirmed without screenshots.

### UX-005 — Visual and responsive behavior remains unverified

- **Screen/component:** All routes and forms, including quotations, work orders, service-report verification, and field job/upload flows
- **Problem:** The browser automation runtime failed to initialize, and there was no local seeded account. Only the unauthenticated login routes could be requested over HTTP. No screenshot or keyboard/mobile viewport evidence is available.
- **User impact:** Clipping, contrast, long-table behavior, modal sizing, mobile overflow, and real-user form friction cannot be ruled in or out from source review alone.
- **Recommendation:** Once a local database and demo seed account are available, manually inspect all route groups at desktop and mobile widths. Check focus order, dialog dismissal, screen-reader names, contrast, loading/empty/error states, and core workflows with realistic data.
- **Priority:** P1 audit follow-up; **complexity:** Medium.
- **Verification status:** Limitation confirmed. No visual defects are claimed from an unobserved screen.

## Screen coverage and business-user observations

Production builds enumerate these office routes: dashboard; customers/list/detail; sites/detail; assets/detail; inquiries/detail; quotations/list/detail; work-orders/list/detail; service-reports/list/verify/canonical. Field routes include login, My Jobs, and job detail. The build completed successfully, but route enumeration is not a substitute for interacting with the live screens.

- **Find customer information:** Customer search exists and filters names, email, and phone. It is usable for smaller data volumes; no global search across contacts, sites, assets, or serial numbers was found in the reviewed list page.
- **Create and manage records:** Permission-gated create actions, route-level detail screens, shared loading/error/empty states, and reusable dialogs are present. Database-backed form validation and feedback were not visually exercised.
- **Quotations:** Listing, revision detail, approval, and PDF-related flows exist. Currency and business rule verification is covered more strongly in service/unit tests than it could be in this UI review.
- **Service work:** Work-order routes and technician My Jobs/job detail/upload screens exist. Server-side status/assignment checks are present in API code. No field-user account was available to test the real sequence.
- **Correct mistakes:** Quotation revisions, correction/verification screens, and confirmation dialogs appear in source. Their interaction and destructive-action safeguards require live review.
- **Reports and dashboards:** Dashboard cards and recent activity are permission-gated. The dashboard currently relies on several client-side list requests; pagination is not present on the reviewed list APIs.

## Positive patterns to retain

- Shared office `LoadingState`, `ErrorState`, `EmptyState`, `PageHeader`, breadcrumbs, and status components.
- Permission-gated visible actions backed by server-side authorization.
- Explicit role-aware dashboard sections and separate technician routes.
- Accessible labels on the customer search input and labels wrapping login fields.
- Field request timeouts and upload progress/feedback patterns already present in client code.

## UI priorities

1. Fix customer-row keyboard navigation and verify focus/accessible names.
2. Plan bounded server-side customer/work-order/quotation/service-report lists and useful filters.
3. Parallelize independent dashboard reads without losing per-section error handling.
4. Run screenshot-based desktop/mobile checks once local auth and representative data are available.
5. Align shared interaction and status patterns while retaining the technician app’s touch-first layout.

## Post-setup authenticated UI follow-up — 2026-10-12

The user reports that the authenticated office UI is now visible at `/customers` and that the shared navigation appears. The new `apps/web/src/components/shared/main-navigation.tsx` is mounted by `apps/web/src/app/layout.tsx`; its links are permission-gated and use client-side Next.js navigation. HTTP requests to `/dashboard`, `/customers`, `/quotations`, `/work-orders`, and `/service-reports` returned 200. This confirms the route shells are served; it does not verify authenticated API actions or rendered states.

Browser automation still could not initialize (`failed to write kernel assets: The system cannot find the path specified`). The live screen, responsive breakpoints, keyboard behavior, API request outcomes, and visual hierarchy therefore remain unobserved. The user’s report confirms the menu is visible, but no screenshot-based assertions are made here.

The Supabase development database has since been migrated and seeded with application roles/reference data and a bootstrap user. The seed contains no customer, site, quotation, work-order, or service-report records, so empty states are expected on a fresh database.

### UX-006 — Customer setup has no UI to add sites or contacts

- **Screen/component:** Customer creation and customer detail (`apps/web/src/components/customers/create-customer-dialog.tsx:80`; `apps/web/src/app/customers/[id]/page.tsx:138-224`)
- **Problem:** The customer form says sites and contacts are added afterward. The customer detail page displays Sites and Contacts tabs, but the reviewed web app has no site/contact creation controls. No create-site/create-contact components or calls were found in `apps/web/src`.
- **User impact:** Staff can create a customer but cannot complete its service-location setup from the office UI. Both quotation and standalone work-order forms require a site selection (`apps/web/src/components/quotations/create-quotation-dialog.tsx:98`; `apps/web/src/components/work-orders/create-work-order-dialog.tsx:108-114`), so these workflows cannot proceed for a new customer with no site.
- **Recommendation:** Add permission-gated site and contact creation from their respective customer tabs, with validation, success/error feedback, and list refresh. Confirm whether editing is also required before choosing the form scope.
- **Priority:** P1; **complexity:** Medium.
- **Verification status:** Confirmed by source review; no record was created and no live API workflow was exercised.

### UX-007 — Inquiry and creation workflows are nested under customer detail

- **Screen/component:** Customer detail tabs and main navigation (`apps/web/src/app/customers/[id]/page.tsx:138-224`; `apps/web/src/components/shared/main-navigation.tsx:14-19`)
- **Problem:** Inquiries can be listed and created only inside a customer’s detail page; new quotations and work orders are also launched from their customer tabs. There is no global inquiry list route, and the top-level quotation/work-order indexes are read-only.
- **User impact:** Staff must first locate and open a customer to find inquiries or start several common workflows. With no global inquiry queue, they cannot review all incoming requests across customers in one place.
- **Recommendation:** Consider a permission-gated inquiry queue with search/status filters. Keep customer-scoped creation available; add global create entry points only where required customer/site context can be selected clearly.
- **Priority:** P2; **complexity:** Medium.
- **Verification status:** Confirmed by route tree and component source; workflow usability was not observed in a browser.

### UX-008 — Record rows rely on pointer clicks for navigation

- **Screen/component:** Customer, site, inquiry, quotation, and work-order tables (`apps/web/src/app/customers/page.tsx:116-119`; `apps/web/src/app/customers/[id]/page.tsx:164`; `apps/web/src/components/inquiries/inquiries-tab.tsx:65`; `apps/web/src/components/quotations/quotations-tab.tsx:82`; `apps/web/src/components/work-orders/work-orders-tab.tsx:67`; `apps/web/src/app/sites/[id]/page.tsx:182`)
- **Problem:** Rows use click handlers to navigate but are not semantic links or buttons.
- **User impact:** Keyboard users may not be able to focus or activate records, and assistive technology does not announce the row as a link.
- **Recommendation:** Put a Next.js `<Link>` in the primary identifier cell and retain row highlighting/cursor styling only as a visual aid.
- **Priority:** P1 accessibility; **complexity:** Low.
- **Verification status:** Confirmed by source review; keyboard testing unavailable.

### UX-009 — Asset service-history message is stale relative to available modules

- **Screen/component:** Asset detail (`apps/web/src/app/assets/[id]/page.tsx:182`)
- **Problem:** The asset page says service history will appear “once Service Reports are introduced in a later phase,” while the repository now contains a Service Reports queue and verification workflows. The asset page currently does not present a history section linked to those reports.
- **User impact:** Staff may assume service history is forthcoming or unavailable even when reports exist elsewhere, and cannot review an asset’s history from its record.
- **Recommendation:** Confirm the intended relationship between canonical service reports and assets. Then either show the relevant history or replace the stale copy with an accurate explanation.
- **Priority:** P2; **complexity:** Medium (depends on the report-to-asset relationship).
- **Verification status:** Stale copy confirmed in source; data relationship and product intent require confirmation.

### UX-010 — Customer details cannot be corrected in the office UI

- **Screen/component:** Customer detail and create form (`apps/web/src/app/customers/[id]/page.tsx:100-137`; `apps/web/src/components/customers/create-customer-dialog.tsx`)
- **Problem:** The customer detail header exposes only Activate/Deactivate; no edit action or customer-edit dialog was found. Name, billing address, phone, email, tax ID, and customer type are collected during creation but are displayed read-only afterward.
- **User impact:** Staff cannot correct an ordinary data-entry mistake from the UI, making customer records stale or requiring an administrator/database-level workaround.
- **Recommendation:** Add an edit flow for customer profile fields, gated by the existing customer update permission, with server validation and clear saved/error feedback.
- **Priority:** P1; **complexity:** Medium.
- **Verification status:** Confirmed by source review; no customer record was changed.
