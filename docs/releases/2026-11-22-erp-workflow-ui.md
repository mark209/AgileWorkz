# ERP workflow and UI improvements

## Changes

- Keep quotation subtotal, discount, VAT treatment and totals consistent between
  editing, stored values and the sample-based PDF layout. Use quotation-level tax
  treatment and preserve finalized historical quotation records.
- Support maintenance conversion and one-time visit generation, with linked Work
  Orders and clear generated-state feedback.
- Link additional quotations to the existing Work Order, customer and site.
- Separate Supervisor report review from Manager or Super Admin final approval.
- Preserve scoped Work Order and Service Report visibility, including historical
  records, and expose existing Work Orders through Work Schedule.
- Allow per-report custom type labels alongside existing dropdown choices and
  retain those labels through Field offline synchronization and review.
- Provide accurate outcome dialogs for uploads and important quotation actions.
- Improve Office and Field layouts, including technician summaries, verification
  workspaces, responsive forms and shared navigation/table presentation.

## Database rollout

Apply the checked-in migrations through the existing deployment process before
starting the updated API:

1. `20261119000000_audited_job_workflow`
2. `20261119010000_quotation_sample_fields`
3. `20261120000000_quotation_pdf_layout`
4. `20261121000000_service_report_custom_type`

The first migration also installs the confirmed Supervisor approval permissions
and removes obsolete first-stage grants from management/Office roles. Assign the
designated reviewers to the appropriate Supervisor role through existing member
management. Final approval remains with authorized management accounts.

Generate the Prisma client during the existing build process. No additional
runtime dependencies or scheduling tables are introduced. Existing Work Orders
remain the schedule source of truth; the existing schedule date is also used for
the initial due-date classification.

## Validation

- API unit regression suite: 442 tests passed.
- Office regression suite: 278 tests passed.
- Field regression suite: 76 tests passed.
- Upload/idempotency integration suites: 34 tests passed.
- Local six-account access audit: 336 checks passed.
- API, Office and Field production builds and type checks passed.
- Office and Field lint passed; API lint retained three pre-existing warnings.
- Desktop/mobile browser checks covered technician work, Supervisor review gates,
  customer/quotation/job screens, administration pages and modal sizing.

Integration audits used an isolated local database, fictional records and the
extraction stub. Live cloud OCR and production deployment were not validated by
these local checks. Inline PDF rendering was unavailable in the audit browser;
the original report link returned HTTP 200 with a valid PDF document.

Local account credentials, audit databases, generated PDFs/screenshots and
temporary tools are excluded from this release.
