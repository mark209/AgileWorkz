"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { listManagers, setResponsibleManager, type WorkOrder } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

export function ResponsibleManagerPanel({ workOrder, onChanged }: { workOrder: WorkOrder; onChanged: () => void }) {
  const { user, accessToken, hasPermission } = useAuth();
  const canReassign = user?.roles?.includes("Admin/Owner") && hasPermission("users", "manage");
  const [managers, setManagers] = useState<Array<{ id: string; fullName: string }>>([]);
  const [selected, setSelected] = useState(workOrder.responsibleManagerId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelected(workOrder.responsibleManagerId ?? "");
  }, [workOrder.responsibleManagerId]);
  useEffect(() => {
    if (canReassign && accessToken) listManagers(accessToken).then(setManagers).catch(() => setError("Failed to load Managers."));
  }, [accessToken, canReassign]);

  async function save() {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      await setResponsibleManager(accessToken, workOrder.id, selected || null);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to update the responsible Manager.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="space-y-3 text-sm">
    <p>Responsible Manager: <strong>{workOrder.responsibleManager?.fullName ?? "Unassigned"}</strong></p>
    <p className="text-muted-foreground">The responsible Manager can see and manage this Work Order. Technician assignments are separate.</p>
    {canReassign && <div className="flex flex-wrap items-center gap-2">
      <Select aria-label="Responsible Manager" value={selected} onChange={(event) => setSelected(event.target.value)}>
        <option value="">Unassigned</option>
        {managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.fullName}</option>)}
      </Select>
      <Button onClick={save} disabled={busy || selected === (workOrder.responsibleManagerId ?? "")}>{busy ? "Saving…" : "Save"}</Button>
    </div>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>;
}
