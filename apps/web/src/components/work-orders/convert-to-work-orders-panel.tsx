"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { convertQuotationToWorkOrders, generateMaintenanceVisits, type QuotationType } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Phase 4 Operations Frontend — shown only on an ACCEPTED current revision
 * (the same gate LifecycleActionBar's own actions use), never edited
 * inline into that Phase 3 component. Path A (convert-to-work-orders) is
 * available for any quotation type; "Generate Maintenance Visits" only for
 * PREVENTIVE_MAINTENANCE, matching the backend's own approved §08 rule
 * exactly (the server itself re-validates both — this is UX only).
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
  const { accessToken, hasPermission } = useAuth();
  const [scheduledDate, setScheduledDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [converting, setConverting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCreate = hasPermission("work_orders", "create");
  const canGenerateVisits = hasPermission("work_orders", "generate_maintenance_visits");

  if (!canCreate && !canGenerateVisits) return null;

  async function handleConvert() {
    if (!accessToken) return;
    setConverting(true);
    setError(null);
    try {
      const created = await convertQuotationToWorkOrders(accessToken, quotationId, revisionId, {
        scheduledDate: scheduledDate || undefined,
      });
      onConverted();
      if (created.length === 1) router.push(`/work-orders/${created[0].id}`);
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
    try {
      await generateMaintenanceVisits(accessToken, quotationId, revisionId, startDate);
      onConverted();
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
        {canCreate && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="convert-scheduled-date">Scheduled date (optional)</Label>
              <Input id="convert-scheduled-date" type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
            </div>
            <Button onClick={handleConvert} disabled={converting}>
              {converting ? "Converting…" : "Convert to Work Order"}
            </Button>
          </div>
        )}

        {canGenerateVisits && quotationType === "PREVENTIVE_MAINTENANCE" && (
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
      </CardContent>
    </Card>
  );
}
