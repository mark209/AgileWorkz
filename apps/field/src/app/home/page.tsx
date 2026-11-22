"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { listMyWorkOrders, type WorkOrder } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import { getCachedAssignedWorkOrders, getQueuedServiceReports, saveAssignedWorkOrders } from "@/lib/offline-store";
import { card, colors, dangerText, page, pageHeader, heading, secondaryButton, subheading } from "@/lib/styles";

/**
 * Phase 4 Operations Frontend — "My Jobs", replacing the Phase 1 stub. One
 * call to GET /work-orders/mine (work_orders.read_own, backend-filtered to
 * this technician's currently-active assignments only — see
 * WorkOrdersService.listForTechnician); nothing here re-derives or
 * broadens that scoping on the client.
 */
export default function HomePage() {
  const { user, accessToken, hasPermission, logout } = useAuth();
  const router = useRouter();

  const [jobs, setJobs] = useState<WorkOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offlineSavedAt, setOfflineSavedAt] = useState<number | null>(null);

  const canReadOwn = hasPermission("work_orders", "read_own");
  const canReviewReports = hasPermission("service_reports", "verify");

  const load = useCallback(async () => {
    if (!accessToken || !canReadOwn) return;
    setError(null);
    setOfflineSavedAt(null);
    setJobs(null);
    try {
      const assignedJobs = await listMyWorkOrders(accessToken);
      setJobs(assignedJobs);
      if (user) await saveAssignedWorkOrders(user.id, assignedJobs).catch(() => undefined);
    } catch (e) {
      if (e instanceof ApiError && e.status !== 0) {
        setError(e.status === 403 ? "Your account cannot view assigned jobs." : e.message);
        return;
      }
      const cached = user ? await getCachedAssignedWorkOrders(user.id).catch(() => null) : null;
      if (cached) {
        setJobs(cached.workOrders);
        setOfflineSavedAt(cached.savedAt);
      } else {
        setError(e instanceof ApiError ? e.message : "Failed to load your jobs. No recent offline copy is available.");
      }
    }
  }, [accessToken, canReadOwn, user]);

  useEffect(() => {
    if (!user) router.replace("/login");
  }, [user, router]);

  useEffect(() => {
    load();
  }, [load]);

  async function signOut() {
    const queued = user ? await getQueuedServiceReports(user.id).catch(() => []) : [];
    if (queued.length > 0 && !window.confirm(
      `${queued.length} unsent service ${queued.length === 1 ? "report is" : "reports are"} saved on this device. They will stay here and sync only after this same technician signs in again. Continue signing out?`,
    )) return;
    try {
      await logout();
      router.push("/login");
    } catch {
      window.alert("Could not sign out. Please try again.");
    }
  }

  if (!user) return null;

  return (
    <main style={page}>
      <div style={pageHeader}>
        <div>
          <h1 style={heading}>Hello, {user.fullName}</h1>
          <p style={subheading}>{canReadOwn ? "My Assigned Work Orders" : "AgileWorks Field"}</p>
        </div>
        <button
          style={secondaryButton}
          onClick={signOut}
        >
          Sign out
        </button>
      </div>

      {(hasPermission("service_reports", "read_own") || hasPermission("service_reports", "upload")) && (
        <Link href="/reports" style={{ ...card, display: "block", fontWeight: 600, color: colors.green }}>
          My Service Reports and direct upload →
        </Link>
      )}

      {!canReadOwn && <section style={card}>
        <p style={subheading}>AgileWorks Field shows technician assignments. Your current role does not include assigned technician jobs.</p>
        <p style={{ ...subheading, marginTop: 12 }}>{canReviewReports
          ? "Open AgileWorks Office and choose Service Reports to review reports and use your permitted approval actions. Sign in there with this same approved account."
          : "Open AgileWorks Office to use the features available to your role. Sign in there with this same approved account."}</p>
      </section>}

      {canReadOwn && error && (
        <div>
          <p style={dangerText}>{error}</p>
          <button style={secondaryButton} onClick={load}>
            Try again
          </button>
        </div>
      )}

      {canReadOwn && !error && jobs === null && <p style={subheading}>Loading your jobs…</p>}

      {offlineSavedAt !== null && (
        <p role="status" style={{ ...subheading, color: colors.textMuted }}>
          Offline copy — last refreshed {formatDateTime(offlineSavedAt)}. Job changes require a connection.
        </p>
      )}

      {canReadOwn && !error && jobs !== null && jobs.length === 0 && (
        <p style={subheading}>No assigned jobs right now. New assignments will show up here.</p>
      )}

      {canReadOwn && !error && jobs !== null && jobs.length > 0 && <>
        <section aria-label="Assigned work summary" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, margin: "20px 0 24px" }}>
          {[{ label: "Assigned", count: jobs.length }, { label: "Ready to start", count: jobs.filter(job => job.status === "SCHEDULED").length }, { label: "In progress", count: jobs.filter(job => job.status === "IN_PROGRESS").length }].map(item => <div key={item.label} style={{ ...card, padding: 12, margin: 0 }}><p style={{ ...subheading, fontSize: 12, margin: 0 }}>{item.label}</p><p style={{ fontSize: 24, fontWeight: 650, margin: "6px 0 0", fontVariantNumeric: "tabular-nums" }}>{item.count}</p></div>)}
        </section>
        <h2 style={{ fontSize: 17, margin: "0 0 8px" }}>Your work queue</h2>
        <p style={{ ...subheading, marginBottom: 16 }}>{jobs.length} assigned {jobs.length === 1 ? "Work Order" : "Work Orders"}. Open one to view the permitted next action.</p>
      </>}

      {canReadOwn &&
        !error &&
        jobs !== null &&
        jobs.map((job) => (
          <Link key={job.id} href={`/jobs/${job.id}`} style={card}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, borderBottom: `1px solid ${colors.border}`, paddingBottom: 12, marginBottom: 12 }}>
              <strong>{job.workOrderNumber}</strong>
              <StatusBadge status={job.status} />
            </div>
            <p style={{ margin: "6px 0 0", color: colors.textMuted, fontSize: 14 }}>
              <strong style={{ color: "#183c33", fontWeight: 600 }}>{job.customer.name}</strong><br />{job.site.label}
            </p>
            {job.scheduledDate && (
              <p style={{ margin: "4px 0 0", color: colors.textMuted, fontSize: 13 }}>
                Scheduled: {formatDate(job.scheduledDate)}
              </p>
            )}
            <p style={{ margin: "14px 0 0", paddingTop: 12, borderTop: `1px solid ${colors.border}`, color: colors.green, fontSize: 14, fontWeight: 600 }}>
              {job.status === "SCHEDULED" ? "Open to start job →" : job.status === "IN_PROGRESS" || job.status === "COMPLETED" ? "Open to upload report →" : "View Work Order →"}
            </p>
          </Link>
        ))}
    </main>
  );
}
