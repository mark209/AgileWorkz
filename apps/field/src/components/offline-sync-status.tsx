"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { getQueuedServiceReports, removeQueuedServiceReport, type QueuedServiceReport } from "@/lib/offline-store";
import { OFFLINE_QUEUE_UPDATED_EVENT, syncQueuedServiceReports } from "@/lib/offline-sync";
import { useNetworkStatus } from "@/lib/use-network-status";
import { colors } from "@/lib/styles";

export function OfflineSyncStatus() {
  const { user, accessToken } = useAuth();
  const online = useNetworkStatus();
  const [queuedReports, setQueuedReports] = useState<QueuedServiceReport[]>([]);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);

  const refreshQueue = useCallback(async () => {
    if (!user) {
      setQueuedReports([]);
      return;
    }
    try {
      setQueuedReports(await getQueuedServiceReports(user.id));
    } catch {
      // Online work remains available if this browser cannot use IndexedDB.
      setQueuedReports([]);
    }
  }, [user]);

  const sync = useCallback(async () => {
    if (!online || !user || !accessToken || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      await syncQueuedServiceReports(user.id, accessToken).catch(() => undefined);
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      await refreshQueue();
    }
  }, [online, user, accessToken, refreshQueue]);

  useEffect(() => {
    void refreshQueue();
  }, [refreshQueue]);

  useEffect(() => {
    if (online && accessToken) void sync();
  }, [online, accessToken, sync]);

  useEffect(() => {
    window.addEventListener("online", sync);
    window.addEventListener(OFFLINE_QUEUE_UPDATED_EVENT, refreshQueue);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener(OFFLINE_QUEUE_UPDATED_EVENT, refreshQueue);
    };
  }, [sync, refreshQueue]);

  const needsAttention = queuedReports.filter((report) => report.status === "NEEDS_ATTENTION").length;
  const pending = queuedReports.length - needsAttention;
  if (online && queuedReports.length === 0) return null;

  return (
    <div role="status" style={{ background: online ? "#fff7e6" : "#fff1df", color: "#17302b", padding: "10px 16px", fontSize: 14 }}>
      {!online && "You’re offline. Saved job details may be up to 12 hours old; job status changes need a connection. Use a screen-locked device because saved reports stay in this browser."}
      {!online && queuedReports.length > 0 && ` ${queuedReports.length} saved service ${queuedReports.length === 1 ? "report is" : "reports are"} waiting on this device.`}
      {online && pending > 0 && `${syncing ? "Sending" : "Waiting to send"} ${pending} saved service ${pending === 1 ? "report" : "reports"}.`}
      {needsAttention > 0 && ` ${needsAttention} report${needsAttention === 1 ? " needs" : "s need"} office attention and remain saved on this device.`}
      {online && pending > 0 && (
        <button type="button" onClick={() => void sync()} disabled={syncing} style={{ marginLeft: 10, minHeight: 36 }}>
          {syncing ? "Sending…" : "Try sending now"}
        </button>
      )}
      {queuedReports.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary>View saved reports ({queuedReports.length})</summary>
          <ul style={{ margin: "8px 0", paddingLeft: 22 }}>
            {queuedReports.map((report) => (
              <li key={report.idempotencyKey} style={{ marginBottom: 8 }}>
                <span>{report.fileName} — Work Order {report.workOrderId}</span>
                {report.status === "NEEDS_ATTENTION" && <span>: {report.errorMessage}</span>}
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm(`Delete the saved local copy of ${report.fileName}? It cannot be recovered from this device.`)) return;
                    await removeQueuedServiceReport(report.idempotencyKey);
                    await refreshQueue();
                  }}
                  style={{ display: "block", marginTop: 4, minHeight: 36 }}
                >
                  Delete saved copy
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
