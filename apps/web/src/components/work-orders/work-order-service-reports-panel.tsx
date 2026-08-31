"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { listServiceReportsForWorkOrder, type ServiceReportListItem } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";

/**
 * Phase 4 Operations Frontend — Service Reports linked to this Work Order.
 * Never duplicates anything about how a report is itself extracted,
 * verified, confirmed, or locked — that remains entirely Phase 5's own
 * frozen pipeline. Every row links to the existing verify page
 * (/service-reports/:id/verify), which already renders the correct
 * read-only/canonical-link view for CONFIRMED/LOCKED reports on its own —
 * this panel never needs to branch on status to pick a destination.
 */
export function WorkOrderServiceReportsPanel({ workOrderId }: { workOrderId: string }) {
  const { accessToken } = useAuth();
  const [reports, setReports] = useState<ServiceReportListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setError(null);
    try {
      setReports(await listServiceReportsForWorkOrder(accessToken, workOrderId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load linked Service Reports.");
    }
  }, [accessToken, workOrderId]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (reports === null) return <LoadingState label="Loading linked Service Reports…" />;
  if (reports.length === 0) {
    return <EmptyState title="No Service Reports yet" description="A technician can upload one against this work order from the field app." />;
  }

  return (
    <ul className="flex flex-col gap-2">
      {reports.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
          <div>
            <p className="font-medium">{r.serviceReportNumber}</p>
            <p className="text-xs text-muted-foreground">{new Date(r.uploadedAt).toLocaleString()}</p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={r.status} />
            <Link href={`/service-reports/${r.id}/verify`} className="font-medium text-primary hover:underline">
              View →
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}
