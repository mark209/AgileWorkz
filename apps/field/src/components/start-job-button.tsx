"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { startWorkOrder, type WorkOrder } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
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
      <button style={{ ...primaryButton, width: "100%" }} disabled={submitting} onClick={handleStart}>
        {submitting ? "Starting…" : "Start Job"}
      </button>
      {error && <p style={{ ...dangerText, marginTop: 8 }}>{error}</p>}
    </div>
  );
}
