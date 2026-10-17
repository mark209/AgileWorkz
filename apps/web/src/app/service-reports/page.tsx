"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { listServiceReports, type ServiceReportListItem } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// The existing queue is also a scoped list for users with read_assigned.
// The API decides which records are visible; this page only chooses useful
// destinations and action labels from the caller's effective permissions.
export default function ServiceReportsQueuePage() {
  const { accessToken, hasPermission, isLoading: authLoading } = useAuth();
  const [reports, setReports] = useState<ServiceReportListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const canRead = hasPermission("service_reports", "read") || hasPermission("service_reports", "read_assigned");
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
    if (!accessToken || !canRead) return;
    setError(null);
    setReports(null);
    try {
      setReports(await listServiceReports(accessToken, "PENDING_VERIFICATION,VERIFIED,CONFIRMED"));
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? "Access denied to these Service Reports." : e instanceof ApiError ? e.message : "Failed to load Service Reports.");
    }
  }, [accessToken, canRead]);

  useEffect(() => {
    load();
  }, [load]);

  if (authLoading) return <LoadingState />;
  if (!canRead) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <ErrorState message="You do not have permission to view Service Reports." />
      </div>
    );
  }

  const query = search.trim().toLowerCase();
  const visibleReports = reports?.filter((report) =>
    report.serviceReportNumber.toLowerCase().includes(query) ||
    report.reportTypeCode.replaceAll("_", " ").toLowerCase().includes(query),
  ) ?? [];

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <PageHeader title="Service Reports" description={canVerify ? "Review reports ready for verification, confirmation, or locking." : "Service Reports available to you."} />

      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input aria-label="Search service reports" placeholder="Search report number or type" className="pl-8" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>

      {error && <ErrorState message={error} onRetry={load} />}
      {!reports && !error && <LoadingState label="Loading queue…" />}
      {reports && reports.length === 0 && (
        <EmptyState title="No reports to review" description="No Service Reports are currently awaiting verification, confirmation, or locking." />
      )}
      {reports && reports.length > 0 && visibleReports.length === 0 && (
        <EmptyState title="No matching service reports" description="Try a different search term." />
      )}

      {visibleReports.length > 0 && (
        <Card>
          <CardContent className="overflow-x-auto pt-6">
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
                    <TableCell className="font-medium">{r.status === "CONFIRMED" || canVerify ? <Link href={r.status === "CONFIRMED" ? `/service-reports/${r.id}/canonical` : `/service-reports/${r.id}/verify`} className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{r.serviceReportNumber}</Link> : r.serviceReportNumber}</TableCell>
                    <TableCell>{r.reportTypeCode.replaceAll("_", " ")}</TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell>{new Date(r.uploadedAt).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      {r.status === "CONFIRMED" ? (
                        <Link href={`/service-reports/${r.id}/canonical`} className="text-sm font-medium text-primary hover:underline">
                          {canLock ? "Lock →" : "View →"}
                        </Link>
                      ) : canVerify ? (
                        <Link href={`/service-reports/${r.id}/verify`} className="text-sm font-medium text-primary hover:underline">
                          {r.status === "VERIFIED" ? (canConfirm ? "Confirm →" : "View →") : "Verify →"}
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
