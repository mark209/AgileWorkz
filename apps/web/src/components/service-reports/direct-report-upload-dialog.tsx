"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { listServiceReportTypes, searchDirectReportTargets, uploadCustomerServiceReport, type DirectReportTarget, type Site } from "@/lib/api";
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

export function DirectReportUploadDialog({ customerId, sites, onUploaded }: { customerId?: string; sites?: Site[]; onUploaded: () => void }) {
  const { accessToken, hasPermission } = useAuth();
  const [open, setOpen] = useState(false);
  const [types, setTypes] = useState<Array<{ code: string; label: string }>>([]);
  const [siteId, setSiteId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [targets, setTargets] = useState<DirectReportTarget[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [searching, setSearching] = useState(false);
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

  useEffect(() => {
    if (!open || !accessToken || customerId || customerSearch.trim().length < 2) {
      setTargets([]);
      setSearching(false);
      return;
    }
    let active = true;
    setSearching(true);
    const timer = setTimeout(() => {
      searchDirectReportTargets(accessToken, customerSearch.trim())
        .then((values) => { if (active) setTargets(values); })
        .catch((cause) => { if (active) setError(cause instanceof ApiError ? cause.message : "Could not search customers."); })
        .finally(() => { if (active) setSearching(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [open, accessToken, customerId, customerSearch]);

  const activeCustomerId = customerId ?? selectedCustomerId;
  const activeSites = customerId
    ? (sites ?? []).filter((site) => site.status === "ACTIVE")
    : (targets.find((target) => target.id === selectedCustomerId)?.sites ?? []);

  if (!hasPermission("service_reports", "upload")) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!accessToken || !activeCustomerId || !file || !siteId || !reportTypeCode || !sourceType) return;
    setBusy(true);
    setError(null);
    try {
      await uploadCustomerServiceReport(accessToken, activeCustomerId, { siteId, reportTypeCode, sourceType, file, idempotencyKey });
      setIdempotencyKey(crypto.randomUUID());
      setSiteId(""); setSelectedCustomerId(""); setCustomerSearch(""); setReportTypeCode(""); setSourceType(""); setFile(null);
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
        <DialogHeader><DialogTitle>Upload direct service report</DialogTitle><DialogDescription>For a legitimate visit without a linked Work Order. Super Admin reviews the uploaded document.</DialogDescription></DialogHeader>
        <div className="mt-4 space-y-4">
          {!customerId && <>
            <div className="space-y-1.5"><Label htmlFor="direct-customer-search">Find customer</Label><Input id="direct-customer-search" value={customerSearch} onChange={(e) => { setCustomerSearch(e.target.value); setSelectedCustomerId(""); setSiteId(""); }} placeholder="Enter at least 2 characters" /><p className="text-xs text-muted-foreground">Choose the customer and site where the direct visit took place.</p></div>
            <div className="space-y-1.5"><Label htmlFor="direct-customer">Customer</Label><Select id="direct-customer" value={selectedCustomerId} onChange={(e) => { setSelectedCustomerId(e.target.value); setSiteId(""); }} required><option value="">{searching ? "Searching…" : "Select customer"}</option>{targets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</Select></div>
          </>}
          <div className="space-y-1.5"><Label htmlFor="direct-site">Site</Label><Select id="direct-site" value={siteId} onChange={(e) => setSiteId(e.target.value)} required><option value="">Select site</option>{activeSites.map((site) => <option key={site.id} value={site.id}>{site.label}</option>)}</Select></div>
          <div className="space-y-1.5"><Label htmlFor="direct-type">Report type</Label><Select id="direct-type" value={reportTypeCode} onChange={(e) => setReportTypeCode(e.target.value)} required><option value="">Select type</option>{types.map((type) => <option key={type.code} value={type.code}>{type.label}</option>)}</Select></div>
          <div className="space-y-1.5"><Label htmlFor="direct-reason">Reason for direct report</Label><Select id="direct-reason" value={sourceType} onChange={(e) => setSourceType(e.target.value)} required><option value="">Select reason</option>{REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></div>
          <div className="space-y-1.5"><Label htmlFor="direct-file">Signed report (PDF or image, up to 25 MB)</Label><Input id="direct-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required /></div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="mt-6"><Button type="submit" disabled={busy || !activeCustomerId || !activeSites.some((site) => site.id === siteId)}>{busy ? "Uploading…" : "Upload report"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
