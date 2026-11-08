"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { listMyWorkOrders, type WorkOrder } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
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
    await logout();
    router.push("/login");
  }

  if (!user) return null;

  return (
    <main style={page}>
      <div style={pageHeader}>
        <div>
          <h1 style={heading}>Hi, {user.fullName.split(" ")[0]}</h1>
          <p style={subheading}>My Assigned Services</p>
        </div>
        <button
          style={secondaryButton}
          onClick={signOut}
        >
          Sign out
        </button>
      </div>

      {!canReadOwn && <p style={subheading}>Your account isn&apos;t set up to view assigned jobs.</p>}

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
          Offline copy — last refreshed {new Date(offlineSavedAt).toLocaleString()}. Job changes require a connection.
        </p>
      )}

      {canReadOwn && !error && jobs !== null && jobs.length === 0 && (
        <p style={subheading}>No assigned jobs right now. New assignments will show up here.</p>
      )}

      {canReadOwn && !error && jobs !== null && jobs.length > 0 && (
        <p style={subheading}>{jobs.length} assigned {jobs.length === 1 ? "service" : "services"}. Open one to view the permitted next action.</p>
      )}

      {canReadOwn &&
        !error &&
        jobs !== null &&
        jobs.map((job) => (
          <Link key={job.id} href={`/jobs/${job.id}`} style={card}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <strong>{job.workOrderNumber}</strong>
              <StatusBadge status={job.status} />
            </div>
            <p style={{ margin: "6px 0 0", color: colors.textMuted, fontSize: 14 }}>
              {job.customer.name} — {job.site.label}
            </p>
            {job.scheduledDate && (
              <p style={{ margin: "4px 0 0", color: colors.textMuted, fontSize: 13 }}>
                Scheduled: {new Date(job.scheduledDate).toLocaleDateString()}
              </p>
            )}
            <p style={{ margin: "8px 0 0", color: colors.green, fontSize: 14, fontWeight: 600 }}>
              {job.status === "SCHEDULED" ? "Open to start job →" : job.status === "IN_PROGRESS" || job.status === "COMPLETED" ? "Open to upload report →" : "View service →"}
            </p>
          </Link>
        ))}
    </main>
  );
}
