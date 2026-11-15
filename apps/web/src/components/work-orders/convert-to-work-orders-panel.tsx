"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { convertQuotationToWorkOrders, correctAcceptedProjectSection, generateMaintenanceVisits, listManagers, type QuotationType } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ActionConfirmDialog } from "@/components/shared/action-confirm-dialog";

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
  sectionCount = 1,
  onConverted,
}: {
  quotationId: string;
  revisionId: string;
  quotationType: QuotationType;
  sectionCount?: number;
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
  const [correctionName, setCorrectionName] = useState("");
  const [correcting, setCorrecting] = useState(false);
  const [confirmCorrection, setConfirmCorrection] = useState(false);
  const [confirmConvert, setConfirmConvert] = useState(false);
  const [confirmGenerate, setConfirmGenerate] = useState(false);

  const canCreate = hasPermission("work_orders", "create");
  const canGenerateVisits = hasPermission("work_orders", "generate_maintenance_visits");
  const canConvert = canCreate && quotationType !== "PREVENTIVE_MAINTENANCE";
  const canGenerateMaintenanceVisits = canGenerateVisits && quotationType === "PREVENTIVE_MAINTENANCE";
  const needsProjectSection = quotationType === "PROJECT" && sectionCount === 0;
  const canCorrect = needsProjectSection && hasPermission("quotations", "update");

  useEffect(() => {
    if (accessToken && canConvert) listManagers(accessToken).then(setManagers).catch(() => setManagers([]));
  }, [accessToken, canConvert]);

  if (!canConvert && !canGenerateMaintenanceVisits && !canCorrect) return null;

  async function handleCorrection() {
    if (!accessToken || !correctionName.trim()) return;
    setCorrecting(true);
    setError(null);
    try {
      await correctAcceptedProjectSection(accessToken, quotationId, revisionId, correctionName.trim());
      setConfirmCorrection(false);
      setSuccess("Section added. You can now convert this quotation to Work Orders.");
      onConverted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not add the section.");
    } finally {
      setCorrecting(false);
    }
  }

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
      setConfirmConvert(false);
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
      setConfirmGenerate(false);
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
        {canCorrect && (
          <div className="space-y-2">
            <p className="text-sm">This accepted PROJECT quotation needs a section before conversion. Its existing line items and prices will be preserved.</p>
            <Label htmlFor="project-section-name">Section name</Label>
            <Input id="project-section-name" value={correctionName} onChange={(event) => setCorrectionName(event.target.value)} maxLength={160} />
            <Button variant="outline" disabled={!correctionName.trim() || correcting} onClick={() => setConfirmCorrection(true)}>Add required section</Button>
          </div>
        )}
        {canConvert && !needsProjectSection && (
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
            <Button onClick={() => setConfirmConvert(true)} disabled={converting}>
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
            <Button onClick={() => setConfirmGenerate(true)} disabled={generating || !startDate}>
              {generating ? "Generating…" : "Generate Maintenance Visits"}
            </Button>
          </div>
        )}

        {error && !confirmCorrection && !confirmConvert && !confirmGenerate && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {success && <p role="status" className="text-sm text-foreground">{success}</p>}
        <ActionConfirmDialog
          open={confirmCorrection}
          onOpenChange={setConfirmCorrection}
          title="Add section to accepted quotation?"
          description="This creates one section and groups the existing line items without changing prices or approval history. The correction is recorded in the audit trail."
          reasonMode="none"
          confirmLabel="Add section"
          submitting={correcting}
          error={error}
          onConfirm={handleCorrection}
        />
        <ActionConfirmDialog open={confirmConvert} onOpenChange={setConfirmConvert} title="Convert quotation to Work Order?" description="This creates operational Work Orders from the accepted quotation. The selected responsible Manager will be assigned explicitly." reasonMode="none" confirmLabel="Convert to Work Order" submitting={converting} error={error} onConfirm={handleConvert} />
        <ActionConfirmDialog open={confirmGenerate} onOpenChange={setConfirmGenerate} title="Generate maintenance visits?" description="This creates scheduled maintenance visits from the accepted quotation." reasonMode="none" confirmLabel="Generate visits" submitting={generating} error={error} onConfirm={handleGenerateVisits} />
      </CardContent>
    </Card>
  );
}
