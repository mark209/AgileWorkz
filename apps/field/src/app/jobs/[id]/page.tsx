"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { getWorkOrder, type WorkOrder } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { StatusBadge } from "@/components/status-badge";
import { StartJobButton } from "@/components/start-job-button";
import { ServiceReportUploadForm } from "@/components/service-report-upload-form";
import { colors, dangerText, page, pageHeader, heading, secondaryButton, subheading } from "@/lib/styles";

/**
 * Phase 4 Operations Frontend — a Technician's own Work Order detail.
 * GET /work-orders/:id carries no static permission on the backend
 * (getForActor resolves read vs. read_own itself); for a Technician that
 * means "currently actively assigned", never anything broader — a 403 here
 * (e.g. after being unassigned) is expected and surfaced as a plain error,
 * not treated as a bug to work around client-side.
 */
export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user, accessToken, hasPermission } = useAuth();

  const [workOrder, setWorkOrder] = useState<WorkOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setError(null);
    setWorkOrder(null);
    try {
      setWorkOrder(await getWorkOrder(accessToken, params.id));
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? "Access denied: this job is no longer assigned to you." : e instanceof ApiError ? e.message : "Failed to load this job.");
    }
  }, [accessToken, params.id]);

  useEffect(() => {
    if (!user) router.replace("/login");
  }, [user, router]);

  useEffect(() => {
    load();
  }, [load]);

  if (!user) return null;

  return (
    <main style={page}>
      <div style={pageHeader}>
        <button style={secondaryButton} onClick={() => router.push("/home")}>
          ← My Jobs
        </button>
      </div>

      {error && (
        <div>
          <p style={dangerText}>{error}</p>
          <button style={secondaryButton} onClick={load}>
            Try again
          </button>
        </div>
      )}

      {!workOrder && !error && <p style={subheading}>Loading job…</p>}

      {workOrder && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <h1 style={heading}>{workOrder.workOrderNumber}</h1>
            <StatusBadge status={workOrder.status} />
          </div>
          <p style={subheading}>
            {workOrder.customer.name} — {workOrder.site.label}
          </p>

          <section style={{ marginTop: 20 }}>
            <p style={{ color: colors.textMuted, fontSize: 14 }}>Service location: {workOrder.site.label}</p>
            {workOrder.scheduledDate && (
              <p style={{ color: colors.textMuted, fontSize: 14 }}>Scheduled: {new Date(workOrder.scheduledDate).toLocaleDateString()}</p>
            )}
            {workOrder.startedAt && (
              <p style={{ color: colors.textMuted, fontSize: 14 }}>Started: {new Date(workOrder.startedAt).toLocaleString()}</p>
            )}
            {workOrder.description && <p style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{workOrder.description}</p>}
            {workOrder.standaloneReason && (
              <p style={{ marginTop: 8, whiteSpace: "pre-wrap", color: colors.textMuted }}>{workOrder.standaloneReason}</p>
            )}
          </section>

          <section style={{ marginTop: 24 }}>
            <StartJobButton workOrder={workOrder} onStarted={load} />
            {workOrder.status !== "SCHEDULED" && <p style={subheading}>Start Job is available only while this service is scheduled.</p>}
          </section>

          <section style={{ marginTop: 28, borderTop: `1px solid ${colors.border}`, paddingTop: 20 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px" }}>Upload Service Report</h2>
            {["IN_PROGRESS", "COMPLETED"].includes(workOrder.status) && hasPermission("service_reports", "upload") ? (
              <ServiceReportUploadForm workOrder={workOrder} />
            ) : (
              <p style={subheading}>{hasPermission("service_reports", "upload") ? "Available once the job is started, while reporting is permitted." : "Your account cannot upload Service Reports."}</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
