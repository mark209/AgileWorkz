"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { assignTechnician, listTechnicians, unassignTechnician, type TechnicianOption, type WorkOrder } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { LoadingState } from "@/components/shared/states";

/**
 * Phase 4 Operations Frontend — technician assignment. Reassignment is
 * modeled exactly as the backend does: unassign + assign, never a single
 * "reassign" call, matching WorkOrderAssignment's own append-only-history
 * schema (D3) — a technician's assignment period is never overwritten,
 * only ended and re-opened.
 */
export function WorkOrderAssignmentPanel({ workOrder, onChanged }: { workOrder: WorkOrder; onChanged: () => void }) {
  const { accessToken, hasPermission } = useAuth();
  const canAssign = hasPermission("work_orders", "assign");

  const [technicians, setTechnicians] = useState<TechnicianOption[] | null>(null);
  const [technicianError, setTechnicianError] = useState<string | null>(null);
  const [selectedTechnicianId, setSelectedTechnicianId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTechnicians = useCallback(async () => {
    if (!accessToken || !canAssign) return;
    setTechnicianError(null);
    try {
      setTechnicians(await listTechnicians(accessToken));
    } catch (e) {
      setTechnicianError(e instanceof ApiError ? e.message : "Failed to load technicians.");
    }
  }, [accessToken, canAssign]);

  useEffect(() => {
    loadTechnicians();
  }, [loadTechnicians]);

  const assignedIds = new Set(workOrder.assignments.map((a) => a.technicianId));
  const availableTechnicians = (technicians ?? []).filter((t) => !assignedIds.has(t.id));

  async function handleAssign() {
    if (!accessToken || !selectedTechnicianId) return;
    setBusy(true);
    setError(null);
    try {
      await assignTechnician(accessToken, workOrder.id, selectedTechnicianId);
      setSelectedTechnicianId("");
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to assign technician.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUnassign(assignmentId: string) {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      await unassignTechnician(accessToken, workOrder.id, assignmentId);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to unassign technician.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">Technicians assigned here can see this Work Order in My Assigned Services. They can start it once the Work Order is scheduled.</p>
      {workOrder.assignments.length === 0 && <p className="text-sm text-muted-foreground">No technician assigned yet.</p>}
      {workOrder.assignments.map((a) => (
        <div key={a.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
          <span className="font-medium">{a.technician.fullName}</span>
          {canAssign && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => handleUnassign(a.id)}>
              Unassign
            </Button>
          )}
        </div>
      ))}

      {canAssign && (
        <div className="flex flex-col gap-2 border-t pt-3">
          {technicianError && <p className="text-sm text-destructive">{technicianError}</p>}
          {!technicianError && technicians === null && <LoadingState label="Loading technicians…" />}
          {!technicianError && technicians !== null && (
            <>
              <Label htmlFor="work-order-technician">Add a Technician</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Select id="work-order-technician" value={selectedTechnicianId} onChange={(e) => setSelectedTechnicianId(e.target.value)} className="h-9 w-auto">
                  <option value="" disabled>
                    Select a technician…
                  </option>
                  {availableTechnicians.map((t) => (
                    <option key={t.id} value={t.id} disabled={t.status !== "ACTIVE"}>
                      {t.fullName}
                      {t.status !== "ACTIVE" ? ` (${t.status})` : ""}
                    </option>
                  ))}
                </Select>
                <Button size="sm" disabled={busy || !selectedTechnicianId} onClick={handleAssign}>
                  Assign Technician
                </Button>
              </div>
              {!availableTechnicians.some((t) => t.status === "ACTIVE") && (
                <p className="text-sm text-muted-foreground">No additional active Technicians are available to assign.</p>
              )}
            </>
          )}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
