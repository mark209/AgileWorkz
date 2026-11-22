"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { listServiceReportTypes, searchDirectReportTargets, uploadCustomerServiceReport, type DirectReportTarget, type Site } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useOutcome } from "@/components/shared/outcome-provider";
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
  const { showOutcome } = useOutcome();
  const [open, setOpen] = useState(false);
  const [types, setTypes] = useState<Array<{ code: string; label: string }>>([]);
  const [typesLoading, setTypesLoading] = useState(false);
  const [typesError, setTypesError] = useState<string | null>(null);
  const [typesRetry, setTypesRetry] = useState(0);
  const [siteId, setSiteId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [targets, setTargets] = useState<DirectReportTarget[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [reportTypeCode, setReportTypeCode] = useState("");
  const [reportTypeOther, setReportTypeOther] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !accessToken) return;
    let active = true;
    setTypesLoading(true);
    setTypesError(null);
    listServiceReportTypes(accessToken)
      .then((values) => { if (active) setTypes(values); })
      .catch((e) => { if (active) setTypesError(e instanceof ApiError ? e.message : "Could not load report types."); })
      .finally(() => { if (active) setTypesLoading(false); });
    return () => { active = false; };
  }, [open, accessToken, typesRetry]);

  useEffect(() => {
    if (!open || !accessToken || customerId || customerSearch.trim().length < 2) {
      setTargets([]);
      setSearching(false);
      setSearched(false);
      setSearchError(null);
      return;
    }
    let active = true;
    setSearching(true);
    setSearched(false);
    setSearchError(null);
    setTargets([]);
    const timer = setTimeout(() => {
      searchDirectReportTargets(accessToken, customerSearch.trim())
        .then((values) => { if (active) { setTargets(values); setSearched(true); } })
        .catch((cause) => { if (active) setSearchError(cause instanceof ApiError ? cause.message : "Could not search customers."); })
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
    if (!accessToken || !activeCustomerId || !file || !siteId || !reportTypeCode || !sourceType || (reportTypeCode === "__custom__" && !reportTypeOther.trim())) return;
    setBusy(true);
    setUploadError(null);
    try {
      const result = await uploadCustomerServiceReport(accessToken, activeCustomerId, { siteId, reportTypeCode: reportTypeCode === "__custom__" ? "OTHER" : reportTypeCode, ...(reportTypeCode === "__custom__" ? { reportTypeOther: reportTypeOther.trim() } : {}), sourceType, file, idempotencyKey });
      showOutcome({ title: "Report uploaded", reference: result.serviceReportNumber, description: "A Supervisor reviews the report first, followed by final approval from the responsible Manager or Super Admin." });
      setReportTypeOther("");
      setIdempotencyKey(crypto.randomUUID());
      setSiteId(""); setSelectedCustomerId(""); setCustomerSearch(""); setReportTypeCode(""); setSourceType(""); setFile(null);
      setOpen(false);
      onUploaded();
    } catch (e) {
      setUploadError(e instanceof ApiError ? e.message : "Could not upload the report.");
    } finally {
      setBusy(false);
    }
  }

  return <Dialog open={open} onOpenChange={(next) => { if (busy && !next) return; setOpen(next); if (!next) { setTypesError(null); setUploadError(null); } }}>
    <DialogTrigger asChild><Button variant="outline" size="sm">Upload direct report</Button></DialogTrigger>
    <DialogContent>
      <form onSubmit={submit}>
        <DialogHeader><DialogTitle>Upload direct service report</DialogTitle><DialogDescription>For a legitimate visit without a linked Work Order. A Supervisor reviews the report before final approval.</DialogDescription></DialogHeader>
        <div className="mt-4 space-y-4">
          {!customerId && <>
            <div className="space-y-1.5"><Label htmlFor="direct-customer-search">Find customer</Label><Input id="direct-customer-search" value={customerSearch} onChange={(e) => { setCustomerSearch(e.target.value); setSelectedCustomerId(""); setSiteId(""); }} placeholder="Enter at least 2 characters" /><p className="text-xs text-muted-foreground">Choose the customer and site where the direct visit took place.</p></div>
            <div className="space-y-1.5"><Label htmlFor="direct-customer">Customer</Label><Select id="direct-customer" value={selectedCustomerId} onChange={(e) => { setSelectedCustomerId(e.target.value); setSiteId(""); }} required><option value="">{searching ? "Searching…" : "Select customer"}</option>{targets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</Select></div>
            {searched && !searching && targets.length === 0 && <p role="status" className="text-sm text-muted-foreground">No customers found. Try a different name.</p>}
            {searchError && <p role="alert" className="text-sm text-destructive">{searchError}</p>}
          </>}
          <div className="space-y-1.5"><Label htmlFor="direct-site">Site</Label><Select id="direct-site" value={siteId} onChange={(e) => setSiteId(e.target.value)} required><option value="">Select site</option>{activeSites.map((site) => <option key={site.id} value={site.id}>{site.label}</option>)}</Select></div>
          <div className="space-y-1.5"><Label htmlFor="direct-type">Report type</Label><Select id="direct-type" value={reportTypeCode} onChange={(e) => setReportTypeCode(e.target.value)} required><option value="">{typesLoading ? "Loading types…" : "Select type"}</option>{types.map((type) => <option key={type.code} value={type.code}>{type.label}</option>)}<option value="__custom__">Custom report type…</option></Select>{reportTypeCode === "__custom__" && <div className="mt-2 space-y-1.5"><Label htmlFor="direct-type-other">Custom report type</Label><Input id="direct-type-other" value={reportTypeOther} onChange={(e) => setReportTypeOther(e.target.value)} maxLength={120} required placeholder="Enter the report type" /></div>}{typesError && <div className="flex items-center gap-2"><p role="alert" className="text-sm text-destructive">{typesError}</p><Button type="button" variant="outline" size="sm" onClick={() => setTypesRetry((count) => count + 1)}>Try again</Button></div>}</div>
          <div className="space-y-1.5"><Label htmlFor="direct-reason">Reason for direct report</Label><Select id="direct-reason" value={sourceType} onChange={(e) => setSourceType(e.target.value)} required><option value="">Select reason</option>{REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></div>
          <div className="space-y-1.5"><Label htmlFor="direct-file">Signed report (PDF or image, up to 25 MB)</Label><Input id="direct-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required /></div>
          {uploadError && <p role="alert" className="text-sm text-destructive">{uploadError}</p>}
        </div>
        <DialogFooter className="mt-6"><Button type="submit" disabled={busy || !activeCustomerId || !activeSites.some((site) => site.id === siteId)}>{busy ? "Uploading…" : "Upload report"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
