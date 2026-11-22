"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { completeFieldWorkOrder, type WorkOrder } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { useNetworkStatus } from "@/lib/use-network-status";
import { dangerText, primaryButton, secondaryButton, subheading } from "@/lib/styles";

export function FieldCompleteButton({ workOrder, onCompleted }: { workOrder: WorkOrder; onCompleted: () => void }) {
  const { accessToken, hasPermission } = useAuth();
  const online = useNetworkStatus();
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; at: string } | null>(null);
  const recordedAt = workOrder.fieldCompletedAt ?? (saved?.id === workOrder.id ? saved.at : null);

  if (recordedAt) return <div><p role="status">Field work marked done: {formatDateTime(recordedAt)}</p><p style={subheading}>The responsible Manager or Super Admin still completes and closes the Work Order.</p></div>;
  if (workOrder.status !== "IN_PROGRESS" || !hasPermission("work_orders", "field_complete_own")) return null;

  async function complete() {
    if (!accessToken || submitting || !online) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await completeFieldWorkOrder(accessToken, workOrder.id);
      if (!result.fieldCompletedAt) throw new Error("Missing completion timestamp");
      setSaved({ id: workOrder.id, at: result.fieldCompletedAt });
      setConfirming(false);
      onCompleted();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not mark field work done. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return <div>
    {!confirming ? <button style={{ ...primaryButton, width: "100%" }} disabled={!online} onClick={() => { setError(null); setConfirming(true); }}>Mark field work done{!online ? " — connect to continue" : ""}</button> : <div role="group" aria-label="Confirm field work done">
      <p>Mark field work done? The Work Order stays In Progress.</p>
      <button style={{ ...primaryButton, width: "100%" }} disabled={submitting || !online} onClick={complete}>{submitting ? "Saving…" : "Confirm field work done"}</button>
      <button style={{ ...secondaryButton, width: "100%", marginTop: 8 }} disabled={submitting} onClick={() => { setConfirming(false); setError(null); }}>Cancel</button>
    </div>}
    <p style={subheading}>The responsible Manager or Super Admin still completes and closes the Work Order.</p>
    {!online && <p style={subheading}>The server must confirm job changes. Connect to continue.</p>}
    {error && <p role="alert" style={dangerText}>{error}</p>}
  </div>;
}
