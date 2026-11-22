"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { listMyServiceReports, listServiceReports, type ServiceReportListItem } from "@/lib/api";
import { DirectReportUploadDialog } from "@/components/service-reports/direct-report-upload-dialog";
import { ApiError } from "@/lib/api-client";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDateTime, formatReportType } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// The existing queue is also a scoped list for users with read_assigned.
// The API decides which records are visible; this page only chooses useful
// destinations and action labels from the caller's effective permissions.
export default function ServiceReportsQueuePage() {
  return <Suspense fallback={<LoadingState />}><ServiceReportsQueueContent /></Suspense>;
}

function ServiceReportsQueueContent() {
  const { accessToken, hasPermission, isLoading: authLoading } = useAuth();
  const status = useSearchParams().get("status");
  const [reports, setReports] = useState<ServiceReportListItem[] | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const requestId = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const canRead = hasPermission("service_reports", "read") || hasPermission("service_reports", "read_assigned");
  const canReadOwn = hasPermission("service_reports", "read_own");
  const ownOnly = !canRead && canReadOwn;
  const listKey = ownOnly ? "mine" : status ?? "all";
  const canVerify = hasPermission("service_reports", "verify");
  const canConfirm = hasPermission("service_reports", "confirm");
  const canLock = hasPermission("service_reports", "lock");

  // Phase 5 Step 6 addition — the queue also surfaces VERIFIED reports (not
  // just PENDING_VERIFICATION), since a Confirm-capable user otherwise has
  // no way to find a report awaiting Confirm through the UI at all.
  // Phase 5 Step 7 addition — same reasoning extended to CONFIRMED: a
  // Lock-capable user otherwise has no way to find a report awaiting Lock
  // either. Each row's action link below is status-appropriate; the
  // destination page itself is always the actual permission gate (a viewer
  // without confirm/lock simply won't see that action once there).
  const load = useCallback(async () => {
    if (!accessToken || (!canRead && !canReadOwn)) return;
    const request = ++requestId.current;
    setError(null);
    setReports(null);
    try {
      const rows = ownOnly
        ? await listMyServiceReports(accessToken)
        : await listServiceReports(accessToken, status || undefined);
      if (request === requestId.current) { setReports(rows); setLoadedKey(listKey); }
    } catch (e) {
      if (request === requestId.current) setError(e instanceof ApiError && e.status === 403 ? "Access denied to these Service Reports." : e instanceof ApiError ? e.message : "Failed to load Service Reports.");
    }
  }, [accessToken, canRead, canReadOwn, ownOnly, status, listKey]);

  useEffect(() => {
    load();
  }, [load]);

  if (authLoading) return <LoadingState />;
  if (!canRead && !canReadOwn) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <ErrorState message="You do not have permission to view Service Reports." />
      </div>
    );
  }

  const query = search.trim().toLowerCase();
  const currentReports = loadedKey === listKey ? reports : null;
  const visibleReports = currentReports?.filter((report) =>
    report.serviceReportNumber.toLowerCase().includes(query) ||
    (report.reportTypeOther ?? "").toLowerCase().includes(query) ||
    report.reportTypeCode.replaceAll("_", " ").toLowerCase().includes(query),
  ) ?? [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title={ownOnly ? "My Service Reports" : "Service Reports"} description={ownOnly ? "Reports you submitted, including direct visits without a Work Order." : status ? `Filtered by status: ${status.replaceAll("_", " ").toLowerCase()}.` : "All Service Reports available to you, including completed reports."} actions={ownOnly && hasPermission("service_reports", "upload") ? <DirectReportUploadDialog onUploaded={load} /> : undefined} />
      {status && !ownOnly && <Link href="/service-reports" className="mb-4 inline-block text-sm font-medium text-primary underline underline-offset-2">Clear status filter</Link>}

      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input aria-label="Search service reports" placeholder="Search report number or type" className="pl-8" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>

      {error && <ErrorState message={error} onRetry={load} />}
      {!currentReports && !error && <LoadingState label={ownOnly ? "Loading your reports…" : "Loading queue…"} />}
      {currentReports && currentReports.length === 0 && (
          <EmptyState title={ownOnly ? "No submitted reports yet" : status ? "No reports with this status" : "No reports to review"} description={ownOnly ? "Your uploaded Service Reports will appear here." : status ? `No Service Reports currently have status ${status.replaceAll("_", " ").toLowerCase()}.` : "No Service Reports are available to you."} />
      )}
      {currentReports && currentReports.length > 0 && visibleReports.length === 0 && (
        <EmptyState title="No matching service reports" description="Try a different search term." />
      )}

      {visibleReports.length > 0 && (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Report #</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleReports.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{!ownOnly && (r.status === "CONFIRMED" || r.status === "LOCKED" || canVerify) ? <Link href={(r.status === "CONFIRMED" || r.status === "LOCKED") ? `/service-reports/${r.id}/canonical` : `/service-reports/${r.id}/verify`} className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{r.serviceReportNumber}</Link> : r.serviceReportNumber}</TableCell>
                    <TableCell>{formatReportType(r.reportTypeCode, r.reportTypeOther)}</TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell>{formatDateTime(r.uploadedAt)}</TableCell>
                    <TableCell className="text-right">
                      {ownOnly ? <details className="text-left text-sm"><summary className="cursor-pointer font-medium text-primary">File details</summary><div className="mt-2 min-w-48 space-y-1 text-muted-foreground"><p>File: {r.documentFileName ?? "Unavailable"}</p></div></details> : (r.status === "CONFIRMED" || r.status === "LOCKED") ? (
                        <Link href={`/service-reports/${r.id}/canonical`} className="text-sm font-medium text-primary hover:underline">
                          {canLock && r.status === "CONFIRMED" ? "Lock →" : "View →"}
                        </Link>
                      ) : canVerify ? (
                        <Link href={`/service-reports/${r.id}/verify`} className="text-sm font-medium text-primary hover:underline">
                          {r.status === "EXTRACTION_FAILED" ? "Review document →" : r.status === "VERIFIED" ? (canConfirm ? "Review →" : "View →") : "Review →"}
                        </Link>
                      ) : <span className="text-muted-foreground">No action</span>}
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
