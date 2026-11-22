"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import Link from "next/link";
import {
  bulkConfirm,
  approveServiceReportDocument,
  completeVerification,
  confirmServiceReport,
  getServiceReportVerification,
  previewBulkConfirm,
  previewConfirm,
  STAGING_CATEGORIES,
  STAGING_CATEGORY_LABELS,
  submitFieldReview,
  type ExtractionReviewStatus,
  type StagingCategory,
  type VerificationView,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { computeReviewProgress } from "@/lib/service-report-field-status";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, LoadingState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatReportType } from "@/lib/format";
import { ApprovalStages } from "@/components/service-reports/approval-stages";
import { DocumentViewer } from "@/components/service-reports/document-viewer";
import { FieldSection } from "@/components/service-reports/field-section";
import { VerificationToolbar } from "@/components/service-reports/verification-toolbar";
import { ConfirmationPanel } from "@/components/service-reports/confirmation-panel";
import { Button } from "@/components/ui/button";

export default function ServiceReportVerifyPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { accessToken, hasPermission, isLoading: authLoading } = useAuth();

  const [view, setView] = useState<VerificationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bulkEligibleCount, setBulkEligibleCount] = useState<number | null>(null);
  const [completedNotice, setCompletedNotice] = useState<string | null>(null);
  const [documentReviewed, setDocumentReviewed] = useState(false);
  const [approvingDocument, setApprovingDocument] = useState(false);

  const canVerify = hasPermission("service_reports", "verify");
  const canConfirm = hasPermission("service_reports", "confirm");
  const canTechnicalApprove = hasPermission("service_reports", "technical_approve");
  const canDocumentApprove = hasPermission("service_reports", "document_approve");
  const pageAction = canDocumentApprove ? "Verify" : "Review";

  const load = useCallback(async () => {
    if (!accessToken || !canVerify) return;
    setError(null);
    try {
      setView(await getServiceReportVerification(accessToken, params.id));
      setBulkEligibleCount(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load verification data.");
    }
  }, [accessToken, canVerify, params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const allFields = useMemo(() => (view ? STAGING_CATEGORIES.flatMap((c) => view.fields[c]) : []), [view]);
  const progress = useMemo(() => computeReviewProgress(allFields), [allFields]);
  const disabled = view ? view.report.status !== "PENDING_VERIFICATION" : true;
  const documentOnly = view?.report.verificationBasis === "DOCUMENT_ONLY" ||
    (view?.report.verificationBasis == null &&
      (view?.report.status === "EXTRACTION_FAILED" || view?.report.status === "PENDING_VERIFICATION") &&
      allFields.length === 0);

  async function handleDocumentApproval() {
    if (!accessToken || !documentReviewed) return;
    setApprovingDocument(true);
    setError(null);
    try {
      await approveServiceReportDocument(accessToken, params.id);
      setCompletedNotice("Document approved. The original report is verified without extracted fields.");
      setDocumentReviewed(false);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not approve this document.");
    } finally {
      setApprovingDocument(false);
    }
  }

  async function handleFieldSubmit(
    category: StagingCategory,
    rowId: string,
    dto: { reviewStatus: ExtractionReviewStatus; verifiedValue?: string },
  ) {
    if (!accessToken) return;
    const updated = await submitFieldReview(accessToken, params.id, category, rowId, dto);
    setView((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        fields: { ...prev.fields, [category]: prev.fields[category].map((f) => (f.id === rowId ? updated : f)) },
      };
    });
    // A field's own eligibility for bulk-confirm just changed — the last
    // preview count would be stale, so require a fresh one.
    setBulkEligibleCount(null);
  }

  async function handleLoadBulkPreview() {
    if (!accessToken) return;
    const preview = await previewBulkConfirm(accessToken, params.id);
    setBulkEligibleCount(preview.eligibleCount);
  }

  async function handleBulkConfirm() {
    if (!accessToken) return;
    await bulkConfirm(accessToken, params.id);
    await load(); // re-fetch — bulk affects many rows across categories, simplest to guarantee consistency
  }

  async function handleComplete() {
    if (!accessToken) return;
    await completeVerification(accessToken, params.id);
    setCompletedNotice("Verification complete — this report has moved to VERIFIED.");
    await load();
  }

  async function handleLoadConfirmPreview() {
    if (!accessToken) throw new Error("Not authenticated.");
    return previewConfirm(accessToken, params.id);
  }

  async function handleConfirm() {
    if (!accessToken) return;
    await confirmServiceReport(accessToken, params.id);
    await load(); // re-fetch — status is now CONFIRMED, switching the page to its read-only + canonical-link state
  }

  if (authLoading) return <LoadingState />;
  if (!canVerify) {
    return (
      <div className="mx-auto max-w-3xl py-16">
        <ErrorState message="You do not have permission to verify Service Reports." />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <Breadcrumbs items={[{ label: "Service Reports", href: "/service-reports" }, { label: pageAction }]} />
      <PageHeader className="mb-0"
        title={view ? `${pageAction} ${formatReportType(view.report.reportTypeCode, view.report.reportTypeOther)} Report` : `${pageAction} Service Report`}
        description={view ? `Document: ${view.report.documentFileName}` : undefined}
        actions={view ? <StatusBadge status={view.report.status} /> : undefined}
      />

      {error && <ErrorState message={error} onRetry={load} />}
      {completedNotice && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{completedNotice}</div>
      )}

      {!view && !error && <LoadingState label="Loading verification data…" />}

      {view && (
        <>
          <ApprovalStages status={view.report.status} />
          <nav aria-label="Verification workspace" className="flex flex-wrap gap-2 lg:hidden">
            <a href="#report-document" className="rounded-md border bg-card px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">View document</a>
            <a href="#report-review" className="rounded-md border bg-card px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Review &amp; approval ↓</a>
          </nav>
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <section id="report-document" aria-label="Original uploaded document" className="min-w-0 scroll-mt-6 rounded-xl border bg-card p-4 shadow-sm lg:sticky lg:top-6 sm:p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
                <div className="min-w-0 flex-1"><h2 className="text-base font-semibold">Original uploaded document</h2><p className="mt-1 break-all text-xs text-muted-foreground">{view.report.documentFileName}</p></div>
                <Button type="button" variant="outline" size="sm" onClick={load}>Refresh document link</Button>
              </div>
              <DocumentViewer url={view.documentUrl} mimeType={view.report.documentMimeType} fileName={view.report.documentFileName} />
            </section>
            <section id="report-review" aria-label="Report review and approval" className="min-w-0 scroll-mt-6 space-y-4">
              <div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Review workspace</p><h2 className="mt-1 text-lg font-semibold">{documentOnly ? "Document review & approval" : "Field review & approval"}</h2></div>
          {!documentOnly && <VerificationToolbar
            progress={progress}
            bulkEligibleCount={bulkEligibleCount}
            onLoadBulkPreview={handleLoadBulkPreview}
            onBulkConfirm={handleBulkConfirm}
            onComplete={handleComplete}
            disabled={disabled}
            canApprove={canTechnicalApprove}
          />}

          {documentOnly && (view.report.status === "PENDING_VERIFICATION" || view.report.status === "EXTRACTION_FAILED") && (
            <div className="rounded-md border border-input bg-card p-4">
              <h2 className="text-base font-semibold">Original document review</h2>
              <p className="mt-1 text-sm text-muted-foreground">Supervisor review is the first approval stage. Manager or Super Admin final approval follows. No report fields are extracted from a document-only report.</p>
              {canDocumentApprove ? (
                <div className="mt-4 flex flex-col gap-3">
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-0.5" checked={documentReviewed} onChange={(event) => setDocumentReviewed(event.target.checked)} />
                    I have reviewed the original Service Report document.
                  </label>
                  <Button type="button" className="self-start" disabled={!documentReviewed || approvingDocument} onClick={handleDocumentApproval}>
                    {approvingDocument ? "Approving…" : "Approve document"}
                  </Button>
                </div>
              ) : <p className="mt-3 text-sm text-muted-foreground">Technical Supervisor or Supervisor review is required.</p>}
            </div>
          )}

          {documentOnly && view.report.status === "VERIFIED" && (
            <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              Supervisor review complete. Awaiting Manager or Super Admin final approval.
              {canConfirm && <Button type="button" className="mt-3 w-full sm:w-auto" onClick={() => { handleConfirm().catch((e) => setError(e instanceof Error ? e.message : "Final approval failed.")); }}>Final approval</Button>}
            </div>
          )}

          {!documentOnly && disabled && view.report.status === "VERIFIED" && (
            <ConfirmationPanel canConfirm={canConfirm} onLoadPreview={handleLoadConfirmPreview} onConfirm={handleConfirm} />
          )}

          {disabled && (view.report.status === "CONFIRMED" || view.report.status === "LOCKED") && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-input bg-muted px-4 py-3 text-sm text-muted-foreground">
              <span>This report is {view.report.status} — verification and confirmation actions are unavailable. The data below is read-only.</span>
              <Link href={`/service-reports/${params.id}/canonical`} className="font-medium text-primary underline underline-offset-2">
                View canonical report →
              </Link>
            </div>
          )}

          {!documentOnly && disabled && view.report.status !== "VERIFIED" && view.report.status !== "CONFIRMED" && view.report.status !== "LOCKED" && (
            <div className="rounded-md border border-input bg-muted px-4 py-3 text-sm text-muted-foreground">
              This report is {view.report.status}, not PENDING_VERIFICATION — verification actions are unavailable. The data below is
              read-only.
            </div>
          )}

            {!documentOnly && <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-base font-semibold">Extracted fields for review</h2>
                <p className="text-sm text-muted-foreground">AI values are provisional until a reviewer confirms or corrects them against the original document.</p>
              </div>
              <nav aria-label="Review sections" className="flex flex-wrap gap-2">
                {STAGING_CATEGORIES.filter(category => view.fields[category].length > 0).map(category => <a key={category} href={`#review-${category}`} className="rounded-md border bg-card px-3 py-2 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{STAGING_CATEGORY_LABELS[category]} · {view.fields[category].length}</a>)}
              </nav>
              {STAGING_CATEGORIES.map((category) => (
                <FieldSection
                  key={category}
                  category={category}
                  label={STAGING_CATEGORY_LABELS[category]}
                  fields={view.fields[category]}
                  disabled={disabled}
                  onSubmit={handleFieldSubmit}
                />
              ))}
            </div>}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
