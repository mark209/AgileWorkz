"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { listServiceReportsForCustomer, type ServiceReportListItem, type Site } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { DirectReportUploadDialog } from "./direct-report-upload-dialog";

export function CustomerServiceReports({ customerId, sites }: { customerId: string; sites: Site[] }) {
  const { accessToken, hasPermission } = useAuth();
  const [reports, setReports] = useState<ServiceReportListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canRead = hasPermission("service_reports", "read");
  const load = useCallback(async () => {
    if (!accessToken || !canRead) return;
    setError(null);
    try { setReports(await listServiceReportsForCustomer(accessToken, customerId)); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Could not load service reports."); }
  }, [accessToken, customerId, canRead]);
  useEffect(() => { load(); }, [load]);

  return <div className="space-y-3">
    <DirectReportUploadDialog customerId={customerId} sites={sites} onUploaded={load} />
    {error && <ErrorState message={error} onRetry={load} />}
    {canRead && !error && reports === null && <LoadingState label="Loading service reports…" />}
    {canRead && reports?.length === 0 && <EmptyState title="No service reports yet" description="Reports from jobs and direct visits will appear here." />}
    {canRead && reports && reports.length > 0 && <ul className="space-y-2">{reports.map((report) =>
      <li key={report.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
        <div><Link className="font-medium text-primary hover:underline" href={`/service-reports/${report.id}/${report.status === "CONFIRMED" || report.status === "LOCKED" ? "canonical" : "verify"}`}>{report.serviceReportNumber}</Link><p className="text-xs text-muted-foreground">{new Date(report.uploadedAt).toLocaleString()}</p></div>
        <StatusBadge status={report.status} />
      </li>,
    )}</ul>}
  </div>;
}
