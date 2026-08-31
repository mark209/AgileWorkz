"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { listServiceReports, type ServiceReportListItem } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// The Human Verification queue — Phase 5 Step 5. Technician never reaches
// this page in practice (no service_reports.verify permission, and the
// underlying GET /service-reports list endpoint itself requires
// service_reports.read, which Technician also lacks), but the explicit
// permission check below keeps the page honest even if someone navigates
// here directly.
export default function ServiceReportsQueuePage() {
  const { accessToken, hasPermission, isLoading: authLoading } = useAuth();
  const [reports, setReports] = useState<ServiceReportListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canVerify = hasPermission("service_reports", "verify");

  // Phase 5 Step 6 addition — the queue also surfaces VERIFIED reports (not
  // just PENDING_VERIFICATION), since a Confirm-capable user otherwise has
  // no way to find a report awaiting Confirm through the UI at all.
  // Phase 5 Step 7 addition — same reasoning extended to CONFIRMED: a
  // Lock-capable user otherwise has no way to find a report awaiting Lock
  // either. Each row's action link below is status-appropriate; the
  // destination page itself is always the actual permission gate (a viewer
  // without confirm/lock simply won't see that action once there).
  const load = useCallback(async () => {
    if (!accessToken || !canVerify) return;
    setError(null);
    try {
      setReports(await listServiceReports(accessToken, "PENDING_VERIFICATION,VERIFIED,CONFIRMED"));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load Service Reports.");
    }
  }, [accessToken, canVerify]);

  useEffect(() => {
    load();
  }, [load]);

  if (authLoading) return <LoadingState />;
  if (!canVerify) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <ErrorState message="You do not have permission to verify Service Reports." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <PageHeader title="Service Report Verification Queue" description="Reports awaiting human verification or Confirm." />

      {error && <ErrorState message={error} onRetry={load} />}
      {!reports && !error && <LoadingState label="Loading queue…" />}
      {reports && reports.length === 0 && (
        <EmptyState title="Nothing to verify" description="No Service Reports are currently pending verification." />
      )}

      {reports && reports.length > 0 && (
        <Card>
          <CardContent className="pt-6">
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
                {reports.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.serviceReportNumber}</TableCell>
                    <TableCell>{r.reportTypeCode.replaceAll("_", " ")}</TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell>{new Date(r.uploadedAt).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      {r.status === "CONFIRMED" ? (
                        <Link href={`/service-reports/${r.id}/canonical`} className="text-sm font-medium text-primary hover:underline">
                          Lock →
                        </Link>
                      ) : (
                        <Link href={`/service-reports/${r.id}/verify`} className="text-sm font-medium text-primary hover:underline">
                          {r.status === "VERIFIED" ? "Confirm →" : "Verify →"}
                        </Link>
                      )}
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
