"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { listServiceReportsForWorkOrder, type ServiceReportListItem } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDateTime } from "@/lib/format";

/**
 * Phase 4 Operations Frontend — Service Reports linked to this Work Order.
 * Never duplicates anything about how a report is itself extracted,
 * verified, confirmed, or locked — that remains entirely Phase 5's own
 * pipeline. Finalized reports open the canonical reader; in-review
 * reports open verification only for callers with that permission.
 */
export function WorkOrderServiceReportsPanel({ workOrderId }: { workOrderId: string }) {
  const { accessToken, hasPermission } = useAuth();
  const canVerify = hasPermission("service_reports", "verify");
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
    return <EmptyState title="No Service Reports yet" description="An assigned technician can upload one against this Work Order from the web or Field app." />;
  }

  return (
    <ul className="flex flex-col gap-2">
      {reports.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
          <div className="min-w-0">
            <p className="break-words font-medium">{r.serviceReportNumber}</p>
            <p className="text-xs text-muted-foreground">{formatDateTime(r.uploadedAt)}</p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={r.status} />
            {(r.status === "CONFIRMED" || r.status === "LOCKED" || canVerify) ? <Link href={`/service-reports/${r.id}/${r.status === "CONFIRMED" || r.status === "LOCKED" ? "canonical" : "verify"}`} className="font-medium text-primary hover:underline">
              View →
            </Link> : <span className="text-xs text-muted-foreground">Awaiting review</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}
