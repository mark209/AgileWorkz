"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { convertQuotationToWorkOrders, generateMaintenanceVisits, listManagers, type QuotationType } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/**
 * Phase 4 Operations Frontend — shown only on an ACCEPTED current revision
 * (the same gate LifecycleActionBar's own actions use), never edited
 * inline into that Phase 3 component. Regular conversion excludes
 * PREVENTIVE_MAINTENANCE; those quotations use Generate Maintenance Visits.
 * The server re-validates both actions — this is UX only.
 */
export function ConvertToWorkOrdersPanel({
  quotationId,
  revisionId,
  quotationType,
  onConverted,
}: {
  quotationId: string;
  revisionId: string;
  quotationType: QuotationType;
  onConverted: () => void;
}) {
  const router = useRouter();
  const { accessToken, hasPermission, user } = useAuth();
  const [scheduledDate, setScheduledDate] = useState("");
  const [responsibleManagerId, setResponsibleManagerId] = useState("");
  const [managers, setManagers] = useState<Array<{ id: string; fullName: string }>>([]);
  const [startDate, setStartDate] = useState("");
  const [converting, setConverting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canCreate = hasPermission("work_orders", "create");
  const canGenerateVisits = hasPermission("work_orders", "generate_maintenance_visits");
  const canConvert = canCreate && quotationType !== "PREVENTIVE_MAINTENANCE";
  const canGenerateMaintenanceVisits = canGenerateVisits && quotationType === "PREVENTIVE_MAINTENANCE";

  useEffect(() => {
    if (accessToken && canConvert) listManagers(accessToken).then(setManagers).catch(() => setManagers([]));
  }, [accessToken, canConvert]);

  if (!canConvert && !canGenerateMaintenanceVisits) return null;

  async function handleConvert() {
    if (!accessToken) return;
    setConverting(true);
    setError(null);
    setSuccess(null);
    try {
      const created = await convertQuotationToWorkOrders(accessToken, quotationId, revisionId, {
        scheduledDate: scheduledDate || undefined,
        responsibleManagerId: responsibleManagerId || undefined,
      });
      onConverted();
      if (created.length === 1 && (hasPermission("work_orders", "read") || responsibleManagerId === user?.id)) {
        router.push(`/work-orders/${created[0].id}`);
      } else if (created.length > 0 && !hasPermission("work_orders", "read") && responsibleManagerId !== user?.id) {
        setSuccess("Work Order created. It will appear in your Work Orders list only if you are its responsible Manager. Super Admin can assign a Manager later.");
      } else if (created.length > 0) {
        setSuccess(`${created.length} Work Orders created. Open Work Orders to review them and assign Technicians.`);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to convert to a work order.");
    } finally {
      setConverting(false);
    }
  }

  async function handleGenerateVisits() {
    if (!accessToken || !startDate) return;
    setGenerating(true);
    setError(null);
    setSuccess(null);
    try {
      await generateMaintenanceVisits(accessToken, quotationId, revisionId, startDate);
      onConverted();
      setSuccess("Maintenance visits created without a responsible Manager or Technician. Super Admin can assign a Manager, then an authorized user can assign Technicians.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to generate maintenance visits.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Operations</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {canConvert && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="convert-manager">Responsible Manager (optional)</Label>
              <Select id="convert-manager" value={responsibleManagerId} onChange={(e) => setResponsibleManagerId(e.target.value)}>
                <option value="">Unassigned</option>
                {managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.fullName}</option>)}
              </Select>
              <p className="max-w-xs text-sm text-muted-foreground">Manager responsibility and Technician assignment are separate. A Manager sees this Work Order only when explicitly selected.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="convert-scheduled-date">Scheduled date (optional)</Label>
              <Input id="convert-scheduled-date" type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
            </div>
            <Button onClick={handleConvert} disabled={converting}>
              {converting ? "Converting…" : "Convert to Work Order"}
            </Button>
          </div>
        )}

        {canGenerateMaintenanceVisits && (
          <div className="flex flex-wrap items-end gap-3 border-t pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="visits-start-date">First visit date</Label>
              <Input id="visits-start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </div>
            <Button onClick={handleGenerateVisits} disabled={generating || !startDate}>
              {generating ? "Generating…" : "Generate Maintenance Visits"}
            </Button>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        {success && <p role="status" className="text-sm text-foreground">{success}</p>}
      </CardContent>
    </Card>
  );
}
