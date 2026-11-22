"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { completeFieldWorkOrder, listServiceReportTypes, startWorkOrder, uploadWorkOrderServiceReport, type WorkOrder } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { ActionConfirmDialog } from "@/components/shared/action-confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useOutcome } from "@/components/shared/outcome-provider";

export function TechnicianWorkOrderActions({ workOrder, onChanged }: { workOrder: WorkOrder; onChanged: () => void }) {
  const { accessToken, hasPermission } = useAuth();
  const { showOutcome } = useOutcome();
  const [confirmStart, setConfirmStart] = useState(false);
  const [confirmFieldComplete, setConfirmFieldComplete] = useState(false);
  const [fieldCompletion, setFieldCompletion] = useState<{ id: string; at: string } | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [types, setTypes] = useState<Array<{ code: string; label: string }> | null>(null);
  const [reportTypeCode, setReportTypeCode] = useState("");
  const [reportTypeOther, setReportTypeOther] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canStart = workOrder.status === "SCHEDULED" && hasPermission("work_orders", "start_own");
  const fieldCompletedAt = workOrder.fieldCompletedAt ?? (fieldCompletion?.id === workOrder.id ? fieldCompletion.at : null);
  const canFieldComplete = workOrder.status === "IN_PROGRESS" && !fieldCompletedAt && hasPermission("work_orders", "field_complete_own");
  const canUpload = ["IN_PROGRESS", "COMPLETED"].includes(workOrder.status) && hasPermission("service_reports", "upload");

  useEffect(() => {
    if (!uploadOpen || !accessToken) return;
    let active = true;
    listServiceReportTypes(accessToken)
      .then((values) => { if (active) setTypes(values); })
      .catch((cause) => { if (active) setError(cause instanceof ApiError ? cause.message : "Could not load report types."); });
    return () => { active = false; };
  }, [uploadOpen, accessToken]);

  async function start() {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      await startWorkOrder(accessToken, workOrder.id);
      setConfirmStart(false);
      onChanged();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not start this job.");
    } finally {
      setBusy(false);
    }
  }

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!accessToken || !reportTypeCode || !file || (reportTypeCode === "__custom__" && !reportTypeOther.trim())) return;
    setBusy(true);
    setError(null);
    try {
      const result = await uploadWorkOrderServiceReport(accessToken, workOrder.customerId, {
        siteId: workOrder.siteId, workOrderId: workOrder.id, reportTypeCode: reportTypeCode === "__custom__" ? "OTHER" : reportTypeCode, ...(reportTypeCode === "__custom__" ? { reportTypeOther: reportTypeOther.trim() } : {}), file, idempotencyKey,
      });
      showOutcome({ title: "Report uploaded", reference: result.serviceReportNumber, description: "A Supervisor reviews the report first, followed by final approval from the responsible Manager or Super Admin. You can upload another document for this job." });
      setIdempotencyKey(crypto.randomUUID());
      setReportTypeCode("");
      setReportTypeOther("");
      setFile(null);
      setUploadOpen(false);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not upload the Service Report.");
    } finally {
      setBusy(false);
    }
  }

  async function completeField() {
    if (!accessToken || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await completeFieldWorkOrder(accessToken, workOrder.id);
      if (!result.fieldCompletedAt) throw new Error("Missing completion timestamp");
      setFieldCompletion({ id: workOrder.id, at: result.fieldCompletedAt });
      setConfirmFieldComplete(false);
      onChanged();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not mark field work done. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return <Card>
    <CardHeader><CardTitle>Technician next step</CardTitle></CardHeader>
    <CardContent className="space-y-3 text-sm">
      {workOrder.status === "DRAFT" && <p>This Work Order is still Draft. Ask the responsible Manager or Super Admin to move it to Scheduled before starting.</p>}
      {workOrder.status === "SCHEDULED" && <p>This Work Order is scheduled. Start it when you begin the job.</p>}
      {workOrder.status === "IN_PROGRESS" && <p>Attach your Service Report after the work. A Technical Supervisor or Supervisor reviews it first, followed by final approval from the responsible Manager or Super Admin.</p>}
      {workOrder.status === "COMPLETED" && <p>You may attach another Service Report while your assignment remains active. A Technical Supervisor or Supervisor reviews it first, followed by final approval from the responsible Manager or Super Admin.</p>}
      {["CLOSED", "CANCELLED"].includes(workOrder.status) && <p>This Work Order is {workOrder.status.toLowerCase()}. Ask your responsible Manager if a report still needs to be resolved.</p>}
      <div className="flex flex-wrap gap-2">
        {canStart && <Button onClick={() => { setError(null); setConfirmStart(true); }}>Start Job</Button>}
        {canFieldComplete && <Button onClick={() => { setError(null); setConfirmFieldComplete(true); }}>Mark field work done</Button>}
        {canUpload && <Button variant="outline" onClick={() => { setError(null); setUploadOpen(true); }}>Upload Service Report</Button>}
      </div>
      {fieldCompletedAt && <div><p role="status">Field work marked done: {formatDateTime(fieldCompletedAt)}</p><p className="text-muted-foreground">The responsible Manager or Super Admin still completes and closes the Work Order.</p></div>}
      {canFieldComplete && <p className="text-muted-foreground">Mark field work done when your on-site work is finished. The responsible Manager or Super Admin still completes and closes the Work Order.</p>}
      {error && !confirmStart && !confirmFieldComplete && !uploadOpen && <p role="alert" className="text-destructive">{error}</p>}
      <ActionConfirmDialog
        open={confirmStart}
        onOpenChange={(open) => !open && setConfirmStart(false)}
        title="Start this job?"
        description="This changes the Work Order from Scheduled to In Progress. Your current assignment is checked by the server."
        reasonMode="none"
        confirmLabel="Start Job"
        submitting={busy}
        error={error}
        onConfirm={start}
      />
      <ActionConfirmDialog
        open={confirmFieldComplete}
        onOpenChange={(open) => !open && setConfirmFieldComplete(false)}
        title="Mark field work done?"
        description="This records when your field work finished. The Work Order stays In Progress; the responsible Manager or Super Admin still completes and closes it."
        reasonMode="none"
        confirmLabel="Mark field work done"
        submitting={busy}
        error={error}
        onConfirm={completeField}
      />
      <Dialog open={uploadOpen} onOpenChange={(open) => { if (!busy || open) setUploadOpen(open); }}>
        <DialogContent>
          <form onSubmit={upload}>
            <DialogHeader>
              <DialogTitle>Upload Service Report</DialogTitle>
              <DialogDescription>Attach the report for {workOrder.workOrderNumber}. Your active assignment is checked before upload.</DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="wo-report-type">Report type</Label>
                <Select id="wo-report-type" value={reportTypeCode} onChange={(event) => setReportTypeCode(event.target.value)} required>
                  <option value="">Select report type</option>
                  {types?.map((type) => <option key={type.code} value={type.code}>{type.label}</option>)}
                  <option value="__custom__">Custom report type…</option>
                </Select>
                {reportTypeCode === "__custom__" && <div className="space-y-1.5"><Label htmlFor="wo-report-type-other">Custom report type</Label><Input id="wo-report-type-other" value={reportTypeOther} onChange={(event) => setReportTypeOther(event.target.value)} maxLength={120} required placeholder="Enter the report type" /><p className="text-xs text-muted-foreground">Used for this report only; existing report types remain available.</p></div>}
                {types === null && !error && <p className="text-xs text-muted-foreground">Loading available report types…</p>}
                {types?.length === 0 && <p className="text-xs text-muted-foreground">No report types are available. Ask an administrator to enable one.</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wo-report-file">Signed report (PDF or image, up to 25 MB)</Label>
                <Input id="wo-report-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
              </div>
              {error && <p role="alert" className="text-destructive">{error}</p>}
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setUploadOpen(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy || !reportTypeCode || !file || (reportTypeCode === "__custom__" && !reportTypeOther.trim())}>{busy ? "Uploading…" : "Upload report"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </CardContent>
  </Card>;
}
