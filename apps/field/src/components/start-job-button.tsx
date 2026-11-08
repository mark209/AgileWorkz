"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { startWorkOrder, type WorkOrder } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { useNetworkStatus } from "@/lib/use-network-status";
import { dangerText, primaryButton } from "@/lib/styles";

/**
 * Phase 4 Operations Frontend — SCHEDULED -> IN_PROGRESS, the one lifecycle
 * transition a Technician can trigger themselves (work_orders.start_own).
 * The server re-verifies both the SCHEDULED source status and an actual
 * ACTIVE assignment row for this caller (WorkOrdersService.startOwn) —
 * showing this button only when both already look true here is a UX
 * convenience only, never the real authorization.
 */
export function StartJobButton({ workOrder, onStarted }: { workOrder: WorkOrder; onStarted: () => void }) {
  const { accessToken, hasPermission } = useAuth();
  const online = useNetworkStatus();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canStart = hasPermission("work_orders", "start_own");
  if (!canStart || workOrder.status !== "SCHEDULED") return null;

  async function handleStart() {
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await startWorkOrder(accessToken, workOrder.id);
      onStarted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to start job.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <button style={{ ...primaryButton, width: "100%" }} disabled={submitting || !online} onClick={handleStart}>
        {submitting ? "Starting…" : online ? "Start Job" : "Start Job — connect to continue"}
      </button>
      {!online && <p style={{ color: "#63736f", fontSize: 14, marginTop: 8 }}>The server must confirm job status changes.</p>}
      {error && <p style={{ ...dangerText, marginTop: 8 }}>{error}</p>}
    </div>
  );
}
