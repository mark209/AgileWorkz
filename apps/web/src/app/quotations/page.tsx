"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { listQuotations, QUOTATION_TYPE_LABEL, type Quotation } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/**
 * Phase 6 (Dashboard) addition — a minimal, global quotation index, added
 * only so the Dashboard's quotation KPI/queue cards have a real page to
 * link to (individual /quotations/[id] pages already existed; there was no
 * list page). Deliberately not a quotation-module redesign: no create
 * action, no filters beyond the optional ?status= this page reads straight
 * from the URL, same shared Card/Table/StatusBadge/loading-empty-error
 * components every other list page already uses.
 *
 * useSearchParams() requires a Suspense boundary (Next.js App Router bails
 * out of static generation otherwise) — the default export below is just
 * that boundary; all real logic lives in QuotationsListPageContent.
 */
export default function QuotationsListPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <QuotationsListPageContent />
    </Suspense>
  );
}

function QuotationsListPageContent() {
  const { accessToken, hasPermission, isLoading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const status = searchParams.get("status") ?? undefined;

  const [quotations, setQuotations] = useState<Quotation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const canRead = hasPermission("quotations", "read");

  const load = useCallback(async () => {
    if (!accessToken || !canRead) return;
    setError(null);
    setQuotations(null);
    try {
      setQuotations(await listQuotations(accessToken, status));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load quotations.");
    }
  }, [accessToken, canRead, status]);

  useEffect(() => {
    load();
  }, [load]);

  if (authLoading) return <LoadingState />;
  if (!canRead) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <ErrorState message="You do not have permission to view Quotations." />
      </div>
    );
  }

  const query = search.trim().toLowerCase();
  const visibleQuotations = quotations?.filter((q) =>
    q.quotationNumber.toLowerCase().includes(query) ||
    (q.customerReferenceNo ?? "").toLowerCase().includes(query),
  ) ?? [];

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <PageHeader
        title="Quotations"
        description={status ? `Filtered by status: ${status.replaceAll(",", ", ")}` : "All quotations."}
      />

      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input aria-label="Search quotations" placeholder="Search quotation or reference number" className="pl-8" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>

      {error && <ErrorState message={error} onRetry={load} />}
      {!quotations && !error && <LoadingState label="Loading quotations…" />}
      {quotations && quotations.length === 0 && (
        <div className="space-y-3">
          <EmptyState title="No quotations found" description="No quotations match the current filter." />
          {status && <Link href="/quotations" className="inline-block text-sm font-medium text-primary underline underline-offset-2">Clear status filter</Link>}
        </div>
      )}
      {quotations && quotations.length > 0 && visibleQuotations.length === 0 && (
        <EmptyState title="No matching quotations" description="Try a different search term." />
      )}

      {visibleQuotations.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quotation #</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reference #</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleQuotations.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className="font-medium"><Link href={`/quotations/${q.id}`} className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{q.quotationNumber}</Link></TableCell>
                    <TableCell>{QUOTATION_TYPE_LABEL[q.quotationType]}</TableCell>
                    <TableCell>
                      <StatusBadge status={q.status} />
                    </TableCell>
                    <TableCell>{q.customerReferenceNo ?? "—"}</TableCell>
                    <TableCell>{new Date(q.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <Link href={`/quotations/${q.id}`} className="whitespace-nowrap text-sm font-medium text-primary hover:underline">
                        View →
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
