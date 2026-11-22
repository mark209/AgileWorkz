"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { getWorkOrder, type WorkOrder } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import { StartJobButton } from "@/components/start-job-button";
import { FieldCompleteButton } from "@/components/field-complete-button";
import { ServiceReportUploadForm } from "@/components/service-report-upload-form";
import { getCachedAssignedWorkOrder, saveAssignedWorkOrder } from "@/lib/offline-store";
import { card, colors, dangerText, page, pageHeader, heading, secondaryButton, sectionHeading, subheading } from "@/lib/styles";

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
  const [offlineSavedAt, setOfflineSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setError(null);
    setOfflineSavedAt(null);
    setWorkOrder(null);
    try {
      const freshWorkOrder = await getWorkOrder(accessToken, params.id);
      setWorkOrder(freshWorkOrder);
      if (user) await saveAssignedWorkOrder(user.id, freshWorkOrder).catch(() => undefined);
    } catch (e) {
      if (e instanceof ApiError && e.status !== 0) {
        setError(e.status === 403 ? "Access denied: this job is no longer assigned to you." : e.message);
        return;
      }
      const cached = user ? await getCachedAssignedWorkOrder(user.id, params.id).catch(() => null) : null;
      if (cached) {
        setWorkOrder(cached.workOrder);
        setOfflineSavedAt(cached.savedAt);
      } else {
        setError(e instanceof ApiError ? e.message : "Failed to load this job. No recent offline copy is available.");
      }
    }
  }, [accessToken, params.id, user]);

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
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <h1 style={heading}>{workOrder.workOrderNumber}</h1>
            <StatusBadge status={workOrder.status} />
          </div>
          <p style={subheading}>
            {workOrder.customer.name} — {workOrder.site.label}
          </p>

          {offlineSavedAt !== null && (
            <p role="status" style={{ ...subheading, color: colors.textMuted }}>
              Offline copy — last refreshed {formatDateTime(offlineSavedAt)}. Job changes require a connection.
            </p>
          )}

          <section style={{ ...card, marginTop: 20 }}>
            <h2 style={sectionHeading}>Job details</h2>
            <p style={{ color: colors.textMuted, fontSize: 14 }}>Service location: {workOrder.site.label}</p>
            {workOrder.scheduledDate && (
              <p style={{ color: colors.textMuted, fontSize: 14 }}>Scheduled: {formatDate(workOrder.scheduledDate)}</p>
            )}
            {workOrder.startedAt && (
              <p style={{ color: colors.textMuted, fontSize: 14 }}>Started: {formatDateTime(workOrder.startedAt)}</p>
            )}
            {workOrder.description && <p style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{workOrder.description}</p>}
            {workOrder.standaloneReason && (
              <p style={{ marginTop: 8, whiteSpace: "pre-wrap", color: colors.textMuted }}>{workOrder.standaloneReason}</p>
            )}
          </section>

          {(workOrder.tasks?.length ?? 0) > 0 && <section style={card}>
            <h2 style={sectionHeading}>Scope &amp; work instructions</h2>
            <ol style={{ paddingLeft: 22 }}>{workOrder.tasks?.map((task) => <li key={task.id} style={{ marginBottom: 16 }}>
              <p style={{ fontWeight: 600, whiteSpace: "pre-wrap" }}>{task.description}</p>
              {task.method && <p style={{ whiteSpace: "pre-wrap" }}>{task.method}</p>}
              {task.indications && <p style={{ color: colors.textMuted, whiteSpace: "pre-wrap" }}>Indications: {task.indications}</p>}
            </li>)}</ol>
          </section>}

          <section style={card}>
            <h2 style={sectionHeading}>Job actions</h2>
            <StartJobButton workOrder={workOrder} onStarted={load} />
            <FieldCompleteButton workOrder={workOrder} onCompleted={load} />
            {workOrder.status === "DRAFT" && <p style={subheading}>This Work Order is still Draft. Ask the responsible team to move it to Scheduled before starting.</p>}
          </section>

          <section style={{ ...card, marginTop: 20 }}>
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
