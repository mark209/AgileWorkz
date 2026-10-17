"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { listServiceReportTypes, uploadCustomerServiceReport, type Site } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const REASONS = [
  ["EMERGENCY_CALL", "Emergency call"],
  ["WARRANTY_SERVICE", "Warranty service"],
  ["CALLBACK_VISIT", "Callback visit"],
  ["INTERNAL_SERVICE", "Internal service"],
  ["OTHER", "Other"],
] as const;

export function DirectReportUploadDialog({ customerId, sites, onUploaded }: { customerId: string; sites: Site[]; onUploaded: () => void }) {
  const { accessToken, hasPermission } = useAuth();
  const [open, setOpen] = useState(false);
  const [types, setTypes] = useState<Array<{ code: string; label: string }>>([]);
  const [siteId, setSiteId] = useState("");
  const [reportTypeCode, setReportTypeCode] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !accessToken) return;
    listServiceReportTypes(accessToken).then(setTypes).catch((e) => setError(e instanceof ApiError ? e.message : "Could not load report types."));
  }, [open, accessToken]);

  if (!hasPermission("service_reports", "upload")) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!accessToken || !file || !siteId || !reportTypeCode || !sourceType) return;
    setBusy(true);
    setError(null);
    try {
      await uploadCustomerServiceReport(accessToken, customerId, { siteId, reportTypeCode, sourceType, file, idempotencyKey });
      setIdempotencyKey(crypto.randomUUID());
      setSiteId(""); setReportTypeCode(""); setSourceType(""); setFile(null);
      setOpen(false);
      onUploaded();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not upload the report.");
    } finally {
      setBusy(false);
    }
  }

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button variant="outline" size="sm">Upload direct report</Button></DialogTrigger>
    <DialogContent>
      <form onSubmit={submit}>
        <DialogHeader><DialogTitle>Upload direct service report</DialogTitle><DialogDescription>For a visit without a linked work order. The original document will be verified by office staff.</DialogDescription></DialogHeader>
        <div className="mt-4 space-y-4">
          <div className="space-y-1.5"><Label htmlFor="direct-site">Site</Label><Select id="direct-site" value={siteId} onChange={(e) => setSiteId(e.target.value)} required><option value="">Select site</option>{sites.filter((site) => site.status === "ACTIVE").map((site) => <option key={site.id} value={site.id}>{site.label}</option>)}</Select></div>
          <div className="space-y-1.5"><Label htmlFor="direct-type">Report type</Label><Select id="direct-type" value={reportTypeCode} onChange={(e) => setReportTypeCode(e.target.value)} required><option value="">Select type</option>{types.map((type) => <option key={type.code} value={type.code}>{type.label}</option>)}</Select></div>
          <div className="space-y-1.5"><Label htmlFor="direct-reason">Reason for direct report</Label><Select id="direct-reason" value={sourceType} onChange={(e) => setSourceType(e.target.value)} required><option value="">Select reason</option>{REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></div>
          <div className="space-y-1.5"><Label htmlFor="direct-file">Signed report (PDF or image, up to 25 MB)</Label><Input id="direct-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required /></div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="mt-6"><Button type="submit" disabled={busy || !sites.some((site) => site.status === "ACTIVE")}>{busy ? "Uploading…" : "Upload report"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
