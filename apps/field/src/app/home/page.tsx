"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { listMyWorkOrders, type WorkOrder } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { StatusBadge } from "@/components/status-badge";
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

  const canReadOwn = hasPermission("work_orders", "read_own");

  const load = useCallback(async () => {
    if (!accessToken || !canReadOwn) return;
    setError(null);
    setJobs(null);
    try {
      setJobs(await listMyWorkOrders(accessToken));
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? "Your account cannot view assigned jobs." : e instanceof ApiError ? e.message : "Failed to load your jobs.");
    }
  }, [accessToken, canReadOwn]);

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
        <div>
          <h1 style={heading}>Hi, {user.fullName.split(" ")[0]}</h1>
          <p style={subheading}>My Assigned Services</p>
        </div>
        <button
          style={secondaryButton}
          onClick={async () => {
            await logout();
            router.push("/login");
          }}
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
