"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { convertQuotationToWorkOrders, correctAcceptedProjectSection, generateMaintenanceVisits, getRevisionWorkOrders, listManagers, type QuotationType, type QuotationWorkOrderGeneration } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { StatusBadge } from "@/components/shared/status-badge";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ActionConfirmDialog } from "@/components/shared/action-confirm-dialog";
import { Textarea } from "@/components/ui/textarea";
import { useOutcome } from "@/components/shared/outcome-provider";

/**
 * Phase 4 Operations Frontend — shown only on an ACCEPTED current revision
 * (the same gate LifecycleActionBar's own actions use), never edited
 * inline into that Phase 3 component. Regular conversion excludes
 * PREVENTIVE_MAINTENANCE; those quotations use Generate Maintenance Visits.
 * The server re-validates both actions — this is UX only.
 */
export function ConvertToWorkOrdersPanel({
  quotationId,
  quotationNumber,
  revisionId,
  quotationType,
  sectionCount = 1,
  onConverted,
  maintenanceFrequency,
  scheduledVisits,
  maintenanceReady = true,
}: {
  quotationId: string;
  quotationNumber?: string;
  revisionId: string;
  quotationType: QuotationType;
  sectionCount?: number;
  onConverted: () => void;
  maintenanceFrequency?: string;
  scheduledVisits?: number;
  maintenanceReady?: boolean;
}) {
  const router = useRouter();
  const { accessToken, hasPermission, user } = useAuth();
  const { showOutcome } = useOutcome();
  const [scheduledDate, setScheduledDate] = useState("");
  const [responsibleManagerId, setResponsibleManagerId] = useState("");
  const [managers, setManagers] = useState<Array<{ id: string; fullName: string }>>([]);
  const [startDate, setStartDate] = useState("");
  const [customVisitDates, setCustomVisitDates] = useState("");
  const [converting, setConverting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [correctionName, setCorrectionName] = useState("");
  const [correcting, setCorrecting] = useState(false);
  const [confirmCorrection, setConfirmCorrection] = useState(false);
  const [confirmConvert, setConfirmConvert] = useState(false);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [generation, setGeneration] = useState<QuotationWorkOrderGeneration | null>(null);
  const [checkingGeneration, setCheckingGeneration] = useState(true);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const generationRequest = useRef(0);

  const canCreate = hasPermission("work_orders", "create");
  const canGenerateVisits = hasPermission("work_orders", "generate_maintenance_visits");
  const canConvert = canCreate && quotationType !== "PREVENTIVE_MAINTENANCE";
  const canGenerateMaintenanceVisits = canGenerateVisits && quotationType === "PREVENTIVE_MAINTENANCE";
  const isMaintenance = quotationType === "PREVENTIVE_MAINTENANCE";
  const inspectGeneration = canConvert || canGenerateMaintenanceVisits || hasPermission("quotations", "read");
  const needsProjectSection = quotationType === "PROJECT" && sectionCount === 0;
  const canCorrect = needsProjectSection && hasPermission("quotations", "update");
  const customSchedule = maintenanceFrequency === "CUSTOM";
  const explicitDates = customVisitDates.split(/[\n,]/).map((value) => value.trim()).filter(Boolean);

  const loadGeneration = useCallback(async () => {
    if (!accessToken || !inspectGeneration) return null;
    const request = ++generationRequest.current;
    setCheckingGeneration(true);
    setGenerationError(null);
    try {
      const result = await getRevisionWorkOrders(accessToken, quotationId, revisionId);
      if (request === generationRequest.current) setGeneration(current => current?.generated && !result.generated ? current : result);
      return result;
    } catch {
      if (request === generationRequest.current) setGenerationError(isMaintenance ? "Could not load visit status. Try again to check the Work Orders before generating." : "Could not load Work Order status. Try again before converting this quotation.");
      return null;
    } finally { if (request === generationRequest.current) setCheckingGeneration(false); }
  }, [accessToken, inspectGeneration, isMaintenance, quotationId, revisionId]);
  const invalidateGeneration = useCallback(() => { generationRequest.current++; }, []);
  useEffect(() => {
    setGeneration(null);
    if (inspectGeneration) void loadGeneration();
    return invalidateGeneration;
  }, [inspectGeneration, loadGeneration, invalidateGeneration]);

  useEffect(() => {
    if (accessToken && (canConvert || canGenerateMaintenanceVisits)) listManagers(accessToken).then(setManagers).catch(() => setManagers([]));
  }, [accessToken, canConvert, canGenerateMaintenanceVisits]);

  if (!canConvert && !canGenerateMaintenanceVisits && !canCorrect && !inspectGeneration) return null;

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
      setGeneration({ generated: true, totalCount: created.length, workOrders: [] });
      setConfirmConvert(false);
      if (created.length > 0) showOutcome({
        title: "Work Orders created",
        reference: quotationNumber,
        description: `${created.length} Draft Work ${created.length === 1 ? "Order was" : "Orders were"} created. Open Work Orders to assign technicians and schedule execution.${!hasPermission("work_orders", "read") && responsibleManagerId !== user?.id ? " These jobs appear in your assigned list only when you are their responsible Manager; Super Admin can assign a Manager if needed." : ""}`,
      });
      onConverted();
      await loadGeneration();
      if (created.length === 1 && (hasPermission("work_orders", "read") || responsibleManagerId === user?.id)) {
        router.push(`/work-orders/${created[0].id}`);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const status = await loadGeneration();
        if (status?.generated) { setConfirmConvert(false); setError(null); return; }
      }
      setError(e instanceof ApiError ? e.message : "Failed to convert to a work order.");
    } finally {
      setConverting(false);
    }
  }

  async function handleGenerateVisits() {
    if (!accessToken || (!customSchedule && !startDate) || (customSchedule && explicitDates.length === 0)) return;
    setGenerating(true);
    setError(null);
    setSuccess(null);
    try {
      const created = customSchedule
        ? await generateMaintenanceVisits(accessToken, quotationId, revisionId, explicitDates[0], responsibleManagerId || undefined, explicitDates)
        : await generateMaintenanceVisits(accessToken, quotationId, revisionId, startDate, responsibleManagerId || undefined);
      setGeneration({ generated: true, totalCount: created.length, workOrders: [] });
      setConfirmGenerate(false);
      if (created.length > 0) showOutcome({
        title: "Maintenance visits generated",
        reference: quotationNumber,
        description: `${created.length} Draft Work ${created.length === 1 ? "Order was" : "Orders were"} created for the planned visits. Open Work Orders to assign technicians and schedule execution.${responsibleManagerId ? " The selected responsible Manager is assigned to these visits." : " No responsible Manager or technician is assigned yet; Super Admin can assign a Manager if needed."}`,
      });
      onConverted();
      await loadGeneration();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const status = await loadGeneration();
        if (status?.generated) { setConfirmGenerate(false); setError(null); return; }
      }
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
        {inspectGeneration && checkingGeneration && <p role="status" className="text-sm text-muted-foreground">{isMaintenance ? "Checking generated visits…" : "Checking Work Orders…"}</p>}
        {inspectGeneration && generationError && <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{generationError}</p><Button variant="outline" size="sm" onClick={() => void loadGeneration()}>{isMaintenance ? "Retry visit status" : "Retry Work Order status"}</Button></div>}
        {inspectGeneration && !(isMaintenance ? canGenerateMaintenanceVisits : canConvert) && generation && !generation.generated && !generationError && <p className="text-sm text-muted-foreground">{isMaintenance ? "No maintenance visits have been generated yet. A user with visit-generation permission can create them from this accepted quotation." : "No Work Orders have been created yet. A user with Work Order creation permission can convert this accepted quotation."}</p>}
        {generation?.generated && <section className="space-y-3" aria-label={isMaintenance ? "Generated maintenance visits" : "Created Work Orders"}>
          <h3 className="text-base font-semibold">{isMaintenance ? "Maintenance visits already generated" : "Work Orders already created"}</h3>
          <p className="text-sm">{generation.totalCount} {isMaintenance ? "visit " : ""}Work {generation.totalCount === 1 ? "Order was" : "Orders were"} created from this revision. Existing records remain linked here, including {isMaintenance ? "visits" : "jobs"} that are later completed or cancelled. A second set cannot be {isMaintenance ? "generated" : "created"}.</p>
          <p className="text-sm text-muted-foreground">Next: open a Work Order, assign its technician or team, then use the existing Schedule action. Technicians start the scheduled job and upload its Service Report. The responsible Manager can see only {isMaintenance ? "visits" : "Work Orders"} assigned to them.</p>
          {generation.workOrders.map(order => <div key={order.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"><div><Link href={`/work-orders/${order.id}`} className="font-medium text-primary underline underline-offset-2">{order.workOrderNumber}</Link><p className="text-muted-foreground">{isMaintenance ? "Visit date" : "Scheduled date"}: {formatDate(order.scheduledDate)}</p></div><StatusBadge status={order.status} /></div>)}
          {generation.workOrders.length < generation.totalCount && <p className="text-sm text-muted-foreground">Some {isMaintenance ? "visits" : "Work Orders"} are outside your Work Order access. Ask Super Admin to assign the responsible Manager if needed.</p>}
          {(hasPermission("work_orders", "read") || hasPermission("work_orders", "read_assigned") || hasPermission("work_orders", "read_own")) && <div className="flex flex-wrap gap-3 text-sm"><Link href="/work-orders" className="text-primary underline">View Work Orders</Link><Link href="/work-schedule" className="text-primary underline">View Work Schedule</Link></div>}
        </section>}
        {canCorrect && !generation?.generated && (
          <div className="space-y-2">
            <p className="text-sm">This accepted PROJECT quotation needs a section before conversion. Its existing line items and prices will be preserved.</p>
            <Label htmlFor="project-section-name">Section name</Label>
            <Input id="project-section-name" value={correctionName} onChange={(event) => setCorrectionName(event.target.value)} maxLength={160} />
            <Button variant="outline" disabled={!correctionName.trim() || correcting} onClick={() => setConfirmCorrection(true)}>Add required section</Button>
          </div>
        )}
        {canConvert && !needsProjectSection && !generation?.generated && (
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
            <Button onClick={() => setConfirmConvert(true)} disabled={converting || checkingGeneration || !!generationError}>
              {converting ? "Converting…" : "Convert to Work Order"}
            </Button>
          </div>
        )}

        {canGenerateMaintenanceVisits && !generation?.generated && (
          <div className="flex flex-wrap items-end gap-3 border-t pt-4">
            <p className="w-full text-sm text-muted-foreground">Generate once: each planned visit becomes a dated Draft Work Order, visible in Work Orders and Work Schedule within your access scope. Assign technicians and schedule execution from each Work Order.</p>
            {!maintenanceReady && <p className="w-full text-sm text-amber-800">Complete the <a href="#quotation-maintenance" className="underline">missing maintenance contract details</a> before generating visits.</p>}
            <div className="space-y-1.5">
              <Label htmlFor="maintenance-manager">Responsible Manager (optional)</Label>
              <Select id="maintenance-manager" value={responsibleManagerId} onChange={(event) => setResponsibleManagerId(event.target.value)}>
                <option value="">Unassigned</option>
                {managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.fullName}</option>)}
              </Select>
              <p className="max-w-xs text-sm text-muted-foreground">Select a Manager so these visits appear in their assigned Work Orders.</p>
            </div>
            <div className="space-y-1.5">
              {customSchedule ? <><Label htmlFor="custom-visit-dates">Visit dates (one per line)</Label><Textarea id="custom-visit-dates" value={customVisitDates} onChange={(e) => setCustomVisitDates(e.target.value)} placeholder="YYYY-MM-DD" rows={4} /><p className="max-w-xs text-xs text-muted-foreground">Enter {scheduledVisits ?? "all"} distinct dates for the custom schedule.</p></> : <><Label htmlFor="visits-start-date">First visit date</Label><Input id="visits-start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required /></>}
            </div>
            <Button onClick={() => setConfirmGenerate(true)} disabled={generating || checkingGeneration || !!generationError || !maintenanceReady || (customSchedule ? explicitDates.length === 0 : !startDate)}>
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
        <ActionConfirmDialog open={confirmGenerate} onOpenChange={setConfirmGenerate} title="Generate maintenance visits?" description="This creates one dated Draft Work Order per visit from the accepted quotation. You will then assign technicians and schedule execution from Work Orders. This can only be done once for this revision." reasonMode="none" confirmLabel="Generate visits" submitting={generating} error={error} onConfirm={handleGenerateVisits} />
      </CardContent>
    </Card>
  );
}
