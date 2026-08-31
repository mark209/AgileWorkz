"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useReferenceData } from "@/lib/use-reference-data";
import {
  getCustomer,
  getQuotation,
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
      setRevisionError(null);
      try {
        const [rev, secs, lines, testing] = await Promise.all([
          getQuotationRevision(accessToken, quotation.id, revisionId),
          listSections(accessToken, quotation.id, revisionId),
          listLineItems(accessToken, quotation.id, revisionId),
          listTestingItems(accessToken, quotation.id, revisionId),
        ]);
        setRevision(rev);
        setSections(secs);
        setLineItems(lines);
        setTestingItems(testing);
        if (quotation.quotationType === "PREVENTIVE_MAINTENANCE") {
          setMaintenanceDetails(await getMaintenanceDetails(accessToken, quotation.id, revisionId));
        } else {
          setMaintenanceDetails(null);
        }
      } catch (e) {
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
    setViewingRevisionId(newRevisionId);
    await loadQuotation();
    await loadRevisionDetail(newRevisionId);
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

  return (
    <main className="container py-8">
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
        description={revision ? `Revision ${revision.revisionNumber}` : undefined}
        actions={<StatusBadge status={quotation.status} />}
      />

      {staleNotice && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{staleNotice}</p>
        </div>
      )}

      <QuotationHeaderCard quotation={quotation} customer={customer} site={site} trade={trade} />

      {revisions.length > 0 && viewingRevisionId && (
        <RevisionHistoryNav revisions={revisions} viewingRevisionId={viewingRevisionId} onSelect={setViewingRevisionId} />
      )}

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

          <RevisionSummaryCard revision={revision} />

          <RevisionFreeTextForm quotationId={quotation.id} revisionId={revision.id} canEdit={canEdit} revision={revision} onChanged={refreshAll} />

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

          {quotation.quotationType === "PREVENTIVE_MAINTENANCE" && (
            <MaintenanceDetailsPanel
              quotationId={quotation.id}
              revisionId={revision.id}
              canEdit={canEdit}
              details={maintenanceDetails}
              onChanged={refreshAll}
            />
          )}

          <TestingItemsPanel
            quotationId={quotation.id}
            revisionId={revision.id}
            canEdit={canEdit}
            items={testingItems}
            onChanged={refreshAll}
          />

          {revision.isCurrent && (
            <LifecycleActionBar
              quotationId={quotation.id}
              revision={revision}
              lineItemCount={lineItems.length}
              onChanged={refreshAll}
              onConflict={handleConflict}
              onNextRevisionCreated={handleNextRevisionCreated}
            />
          )}

          {revision.isCurrent && revision.status === "ACCEPTED" && (
            <ConvertToWorkOrdersPanel
              quotationId={quotation.id}
              revisionId={revision.id}
              quotationType={quotation.quotationType}
              onConverted={refreshAll}
            />
          )}
        </div>
      )}
    </main>
  );
}
