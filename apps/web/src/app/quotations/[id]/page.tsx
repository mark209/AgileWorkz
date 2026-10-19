"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useReferenceData } from "@/lib/use-reference-data";
import {
  getCustomer,
  getQuotation,
  getQuotationPdf,
  getQuotationRevision,
  getMaintenanceDetails,
  listAssetsForSite,
  listLineItems,
  listQuotationRevisions,
  listSections,
  listSitesForCustomer,
  listTestingItems,
  type Asset,
  type Customer,
  type Quotation,
  type QuotationLineItem,
  type QuotationMaintenanceDetails,
  type QuotationRevision,
  type QuotationSection,
  type QuotationTestingCommissioningItem,
  type Site,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, LoadingState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { ActionConfirmDialog } from "@/components/shared/action-confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { QuotationHeaderCard } from "@/components/quotations/quotation-header-card";
import { RevisionHistoryNav } from "@/components/quotations/revision-history-nav";
import { RevisionSummaryCard } from "@/components/quotations/revision-summary-card";
import { RevisionFreeTextForm } from "@/components/quotations/revision-free-text-form";
import { RevisionEditor } from "@/components/quotations/revision-editor";
import { MaintenanceDetailsPanel } from "@/components/quotations/maintenance-details-panel";
import { TestingItemsPanel } from "@/components/quotations/testing-items-panel";
import { LifecycleActionBar } from "@/components/quotations/lifecycle-action-bar";
import { ConvertToWorkOrdersPanel } from "@/components/work-orders/convert-to-work-orders-panel";

export default function QuotationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user, accessToken, hasPermission } = useAuth();
  const { trades } = useReferenceData();

  const [quotation, setQuotation] = useState<Quotation | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [revisions, setRevisions] = useState<QuotationRevision[]>([]);
  const [viewingRevisionId, setViewingRevisionId] = useState<string | null>(null);

  const [revision, setRevision] = useState<QuotationRevision | null>(null);
  const [sections, setSections] = useState<QuotationSection[]>([]);
  const [lineItems, setLineItems] = useState<QuotationLineItem[]>([]);
  const [maintenanceDetails, setMaintenanceDetails] = useState<QuotationMaintenanceDetails | null>(null);
  const [testingItems, setTestingItems] = useState<QuotationTestingCommissioningItem[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pendingRevisionId, setPendingRevisionId] = useState<string | null>(null);
  const [hasUnsavedDetails, setHasUnsavedDetails] = useState(false);
  const revisionRequest = useRef(0);

  const loadQuotation = useCallback(async () => {
    if (!accessToken) return;
    setError(null);
    try {
      const q = await getQuotation(accessToken, params.id);
      setQuotation(q);
      const [cust, revs] = await Promise.all([
        getCustomer(accessToken, q.customerId),
        listQuotationRevisions(accessToken, q.id),
      ]);
      setCustomer(cust);
      setRevisions(revs);
      const siteRows = await listSitesForCustomer(accessToken, q.customerId);
      setSites(siteRows);
      const site = siteRows.find((s) => s.id === q.siteId);
      if (site) setAssets(await listAssetsForSite(accessToken, site.id));

      setViewingRevisionId((prev) => {
        if (prev && revs.some((r) => r.id === prev)) return prev;
        return revs.find((r) => r.isCurrent)?.id ?? revs[revs.length - 1]?.id ?? null;
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load quotation.");
    }
  }, [accessToken, params.id]);

  const loadRevisionDetail = useCallback(
    async (revisionId: string) => {
      if (!accessToken || !quotation) return;
      const request = ++revisionRequest.current;
      setRevisionError(null);
      try {
        const [rev, secs, lines, testing] = await Promise.all([
          getQuotationRevision(accessToken, quotation.id, revisionId),
          listSections(accessToken, quotation.id, revisionId),
          listLineItems(accessToken, quotation.id, revisionId),
          listTestingItems(accessToken, quotation.id, revisionId),
        ]);
        if (request !== revisionRequest.current) return;
        setRevision(rev);
        setSections(secs);
        setLineItems(lines);
        setTestingItems(testing);
        if (quotation.quotationType === "PREVENTIVE_MAINTENANCE") {
          const details = await getMaintenanceDetails(accessToken, quotation.id, revisionId);
          if (request !== revisionRequest.current) return;
          setMaintenanceDetails(details);
        } else {
          setMaintenanceDetails(null);
        }
      } catch (e) {
        if (request !== revisionRequest.current) return;
        setRevisionError(e instanceof ApiError ? e.message : "Failed to load this revision.");
      }
    },
    [accessToken, quotation],
  );

  useEffect(() => {
    loadQuotation();
  }, [loadQuotation]);

  useEffect(() => {
    if (viewingRevisionId) loadRevisionDetail(viewingRevisionId);
  }, [viewingRevisionId, loadRevisionDetail]);

  useEffect(() => {
    if (!user) router.replace("/login");
  }, [user, router]);

  useEffect(() => {
    if (!hasUnsavedDetails) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasUnsavedDetails]);

  const refreshAll = useCallback(async () => {
    await loadQuotation();
    if (viewingRevisionId) await loadRevisionDetail(viewingRevisionId);
  }, [loadQuotation, loadRevisionDetail, viewingRevisionId]);

  function handleConflict() {
    setStaleNotice("This quotation was updated by another user. The latest information has been loaded.");
    refreshAll();
  }

  // Deliberately does NOT go through refreshAll() — that callback closes
  // over the viewingRevisionId from the render it was created in, which is
  // still the OLD (about-to-be-superseded) revision at the moment this
  // fires. Racing refreshAll's stale loadRevisionDetail(oldId) against the
  // viewingRevisionId-change useEffect's loadRevisionDetail(newId) let the
  // stale call win and silently flip the view back to the superseded
  // revision. Calling loadRevisionDetail with the known new id directly
  // sidesteps the race entirely.
  async function handleNextRevisionCreated(newRevisionId: string) {
    revisionRequest.current += 1;
    setHasUnsavedDetails(false);
    setViewingRevisionId(newRevisionId);
    await loadQuotation();
    await loadRevisionDetail(newRevisionId);
  }

  async function downloadPdf() {
    if (!accessToken || !revision || !quotation) return;
    setPdfBusy(true);
    setPdfError(null);
    try {
      const pdf = await getQuotationPdf(accessToken, quotation.id, revision.id);
      const url = URL.createObjectURL(pdf);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${quotation.quotationNumber.replace(/[^a-zA-Z0-9_-]/g, "-")}-rev-${revision.revisionNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setPdfError(e instanceof ApiError ? e.message : "Could not download the quotation PDF.");
    } finally {
      setPdfBusy(false);
    }
  }

  if (!user) return null;

  if (error) {
    return (
      <main className="container py-8">
        <Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Quotation" }]} />
        <ErrorState message={error} onRetry={loadQuotation} />
      </main>
    );
  }

  if (!quotation || !customer) {
    return (
      <main className="container py-8">
        <Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Quotation" }]} />
        <LoadingState label="Loading quotation…" />
      </main>
    );
  }

  const site = sites.find((s) => s.id === quotation.siteId) ?? null;
  const trade = trades.find((t) => t.code === quotation.primaryTradeCode) ?? null;
  const canEdit = !!revision && revision.isCurrent && revision.status === "DRAFT" && hasPermission("quotations", "update");

  function viewRevision(revisionId: string) {
    if (revisionId === viewingRevisionId) return;
    revisionRequest.current += 1;
    setHasUnsavedDetails(false);
    setRevision(null);
    setViewingRevisionId(revisionId);
  }

  function handleSelectRevision(revisionId: string) {
    if (revisionId === viewingRevisionId) return;
    if (canEdit) {
      setPendingRevisionId(revisionId);
      return;
    }
    viewRevision(revisionId);
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Customers", href: "/customers" },
          { label: customer.name, href: `/customers/${customer.id}` },
          { label: quotation.quotationNumber },
        ]}
      />
      <PageHeader
        title={quotation.quotationNumber}
        description={revision ? `Revision ${revision.revisionNumber} · ${customer.name}${site ? ` · ${site.label}` : ""}` : customer.name}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={revision?.status ?? quotation.status} />
            {revision && (
              <Button variant="outline" onClick={downloadPdf} disabled={pdfBusy}>
                {pdfBusy ? "Preparing PDF…" : revision.approvedAt ? "Download quotation PDF" : "Download draft PDF"}
              </Button>
            )}
          </div>
        }
      />

      {revision && (
        <p className="mb-4 text-xs text-muted-foreground">
          {revision.approvedAt
            ? revision.status === "APPROVED"
              ? "Download the approved PDF and send it outside the system. Downloading does not mark it as sent."
              : "Downloading this revision does not change its status."
            : "Draft PDFs are for internal review and are not approved for customer sending."}
        </p>
      )}
      {pdfError && <p role="alert" className="mb-4 text-sm text-destructive">{pdfError}</p>}

      {staleNotice && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{staleNotice}</p>
        </div>
      )}

      <h2 className="mb-3 text-base font-semibold">Customer and Site</h2>
      <QuotationHeaderCard quotation={quotation} customer={customer} site={site} trade={trade} />

      {revisions.length > 0 && viewingRevisionId && (
        <RevisionHistoryNav revisions={revisions} viewingRevisionId={viewingRevisionId} onSelect={handleSelectRevision} />
      )}
      {revision && (
        <nav aria-label="Quotation sections" className="mb-5 flex gap-1 overflow-x-auto border-b text-sm">
          {[
            ["Details", "quotation-details"],
            ["Line Items", "quotation-line-items"],
            ["Commercial Terms", "quotation-commercial-terms"],
            ["Checklist", "quotation-checklist"],
          ].map(([label, id]) => (
            <a key={id} href={`#${id}`} className="shrink-0 rounded-t-md px-3 py-2 font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {label}
            </a>
          ))}
        </nav>
      )}
      <ActionConfirmDialog
        open={pendingRevisionId !== null}
        onOpenChange={(open) => { if (!open) setPendingRevisionId(null); }}
        title="Switch revisions?"
        description="Any unsaved edits in the current draft will be lost. Save them before switching if you need to keep them."
        reasonMode="none"
        confirmLabel="Switch revision"
        submitting={false}
        error={null}
        onConfirm={() => {
          if (pendingRevisionId) viewRevision(pendingRevisionId);
          setPendingRevisionId(null);
        }}
      />

      {revisionError && <ErrorState message={revisionError} onRetry={() => viewingRevisionId && loadRevisionDetail(viewingRevisionId)} />}

      {!revisionError && !revision && <LoadingState label="Loading revision…" />}

      {!revisionError && revision && (
        <div className="space-y-4">
          {!revision.isCurrent && (
            <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
              This is a historical revision — it is read-only. View the current revision to make changes or take
              action.
            </p>
          )}
          {revision.isCurrent && revision.status !== "DRAFT" && (
            <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
              This revision is {revision.status.replace("_", " ").toLowerCase()} — its content is locked. Create a
              new revision to make further changes.
            </p>
          )}
          <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,7fr)_minmax(18rem,3fr)] xl:items-start">
            <div className="min-w-0 space-y-5">
              <section id="quotation-details" className="scroll-mt-6">
                <RevisionFreeTextForm quotationId={quotation.id} revisionId={revision.id} canEdit={canEdit} revision={revision} onChanged={refreshAll} onDirtyChange={setHasUnsavedDetails} />
              </section>

              <section id="quotation-line-items" className="scroll-mt-6">
                <RevisionEditor
                  quotationId={quotation.id}
                  revisionId={revision.id}
                  canEdit={canEdit}
                  sections={sections}
                  lineItems={lineItems}
                  assets={assets}
                  defaultTaxTreatment={revision.defaultTaxTreatment}
                  onChanged={refreshAll}
                />
              </section>

              {quotation.quotationType === "PREVENTIVE_MAINTENANCE" && (
                <MaintenanceDetailsPanel
                  quotationId={quotation.id}
                  revisionId={revision.id}
                  canEdit={canEdit}
                  details={maintenanceDetails}
                  onChanged={refreshAll}
                />
              )}

              <section id="quotation-checklist" className="scroll-mt-6">
                <TestingItemsPanel
                  quotationId={quotation.id}
                  revisionId={revision.id}
                  canEdit={canEdit}
                  items={testingItems}
                  onChanged={refreshAll}
                />
              </section>

              {revision.isCurrent && revision.status === "ACCEPTED" && (
                <ConvertToWorkOrdersPanel
                  quotationId={quotation.id}
                  revisionId={revision.id}
                  quotationType={quotation.quotationType}
                  onConverted={refreshAll}
                />
              )}
            </div>

            <aside aria-label="Quotation summary and actions" className="min-w-0 space-y-4 xl:sticky xl:top-6">
              <RevisionSummaryCard revision={revision} />
              {revision.isCurrent && revision.status === "DRAFT" && (
                <Card className="shadow-none">
                  <CardHeader className="p-4 pb-2"><h2 className="text-base font-semibold">Approval readiness</h2></CardHeader>
                  <CardContent className="space-y-2 px-4 pb-4 pt-0 text-sm">
                    {lineItems.length === 0 ? (
                      <p>At least one saved <a href="#quotation-line-items" className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">line item</a> is required to submit for internal approval.</p>
                    ) : (
                      <p>{lineItems.length} saved line {lineItems.length === 1 ? "item" : "items"} · ready for internal submission.</p>
                    )}
                    {revision.termsAndConditions?.includes("[PLACEHOLDER") && (
                      <p className="border-t pt-2 text-muted-foreground">Before customer sending, replace the placeholder <a href="#quotation-commercial-terms" className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Terms &amp; Conditions</a>.</p>
                    )}
                    <p className="text-xs text-muted-foreground">Readiness reflects saved quotation data. Save details and commercial terms before submitting.</p>
                  </CardContent>
                </Card>
              )}
              {revision.isCurrent && (
                <LifecycleActionBar
                  quotationId={quotation.id}
                  revision={revision}
                  lineItemCount={lineItems.length}
                  hasUnsavedDetails={hasUnsavedDetails}
                  onChanged={refreshAll}
                  onConflict={handleConflict}
                  onNextRevisionCreated={handleNextRevisionCreated}
                />
              )}
            </aside>
          </div>
        </div>
      )}
    </main>
  );
}
