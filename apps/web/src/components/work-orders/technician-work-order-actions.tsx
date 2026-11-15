"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { listServiceReportTypes, startWorkOrder, uploadWorkOrderServiceReport, type WorkOrder } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { ActionConfirmDialog } from "@/components/shared/action-confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export function TechnicianWorkOrderActions({ workOrder, onChanged }: { workOrder: WorkOrder; onChanged: () => void }) {
  const { accessToken, hasPermission } = useAuth();
  const [confirmStart, setConfirmStart] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [types, setTypes] = useState<Array<{ code: string; label: string }> | null>(null);
  const [reportTypeCode, setReportTypeCode] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedNumber, setUploadedNumber] = useState<string | null>(null);

  const canStart = workOrder.status === "SCHEDULED" && hasPermission("work_orders", "start_own");
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
    if (!accessToken || !reportTypeCode || !file) return;
    setBusy(true);
    setError(null);
    try {
      const result = await uploadWorkOrderServiceReport(accessToken, workOrder.customerId, {
        siteId: workOrder.siteId, workOrderId: workOrder.id, reportTypeCode, file, idempotencyKey,
      });
      setUploadedNumber(result.serviceReportNumber);
      setIdempotencyKey(crypto.randomUUID());
      setReportTypeCode("");
      setFile(null);
      setUploadOpen(false);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not upload the Service Report.");
    } finally {
      setBusy(false);
    }
  }

  return <Card>
    <CardHeader><CardTitle>Technician next step</CardTitle></CardHeader>
    <CardContent className="space-y-3 text-sm">
      {workOrder.status === "DRAFT" && <p>This Work Order is still Draft. Ask the responsible Manager or Super Admin to move it to Scheduled before starting.</p>}
      {workOrder.status === "SCHEDULED" && <p>This Work Order is scheduled. Start it when you begin the job.</p>}
      {workOrder.status === "IN_PROGRESS" && <p>Attach your Service Report after the work. Super Admin reviews the uploaded document.</p>}
      {workOrder.status === "COMPLETED" && <p>You may attach another Service Report while your assignment remains active. Super Admin reviews the uploaded document.</p>}
      {["CLOSED", "CANCELLED"].includes(workOrder.status) && <p>This Work Order is {workOrder.status.toLowerCase()}. Ask your responsible Manager if a report still needs to be resolved.</p>}
      <div className="flex flex-wrap gap-2">
        {canStart && <Button onClick={() => { setError(null); setConfirmStart(true); }}>Start Job</Button>}
        {canUpload && <Button variant="outline" onClick={() => { setError(null); setUploadOpen(true); }}>Upload Service Report</Button>}
      </div>
      {uploadedNumber && <p role="status">Service Report {uploadedNumber} uploaded for Super Admin review.</p>}
      {error && !confirmStart && !uploadOpen && <p role="alert" className="text-destructive">{error}</p>}
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
                </Select>
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
              <Button type="submit" disabled={busy || !reportTypeCode || !file}>{busy ? "Uploading…" : "Upload report"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </CardContent>
  </Card>;
}
