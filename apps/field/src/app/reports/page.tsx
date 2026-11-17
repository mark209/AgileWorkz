"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { listMyServiceReports, listServiceReportTypes, searchDirectReportTargets, uploadDirectServiceReport, type DirectReportTarget, type MyServiceReport, type ServiceReportType } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { card, colors, dangerText, heading, page, secondaryButton, subheading } from "@/lib/styles";

const reasons = [
  ["EMERGENCY_CALL", "Emergency call"],
  ["WARRANTY_SERVICE", "Warranty service"],
  ["CALLBACK_VISIT", "Callback visit"],
  ["INTERNAL_SERVICE", "Internal service"],
  ["OTHER", "Other"],
] as const;

const control = { display: "block", width: "100%", minHeight: 42, marginTop: 6, padding: "8px 10px", border: `1px solid ${colors.border}`, borderRadius: 6, background: "white" } as const;
const cameraMimeTypes = "image/jpeg,image/png,image/webp";

const formatCode = (code: string) => code.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function ReportsPage() {
  const router = useRouter();
  const { user, accessToken, hasPermission } = useAuth();
  const canRead = hasPermission("service_reports", "read_own");
  const canUpload = hasPermission("service_reports", "upload");
  const [reports, setReports] = useState<MyServiceReport[] | null>(null);
  const [types, setTypes] = useState<ServiceReportType[]>([]);
  const [targets, setTargets] = useState<DirectReportTarget[]>([]);
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [reportTypeCode, setReportTypeCode] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [loading, setLoading] = useState(false);
  const [typesLoading, setTypesLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [typesError, setTypesError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken || !canRead) return;
    setLoading(true);
    try {
      setReports(await listMyServiceReports(accessToken));
      setListError(null);
    } catch (cause) {
      setListError(cause instanceof ApiError ? cause.message : "Could not load your reports.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, canRead]);

  const loadTypes = useCallback(async () => {
    if (!accessToken || !canUpload) return;
    setTypesLoading(true);
    setTypesError(null);
    try { setTypes(await listServiceReportTypes(accessToken)); }
    catch (cause) { setTypesError(cause instanceof ApiError ? cause.message : "Could not load report types."); }
    finally { setTypesLoading(false); }
  }, [accessToken, canUpload]);

  useEffect(() => { if (!user) router.replace("/login"); }, [user, router]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { void loadTypes(); }, [loadTypes]);
  useEffect(() => {
    if (!accessToken || !canUpload || search.trim().length < 2) { setTargets([]); setSearching(false); setSearched(false); setSearchError(null); return; }
    let active = true;
    setSearching(true);
    setSearched(false);
    setSearchError(null);
    setTargets([]);
    const timer = setTimeout(() => {
      searchDirectReportTargets(accessToken, search.trim())
        .then((values) => { if (active) { setTargets(values); setSearched(true); } })
        .catch((cause) => { if (active) setSearchError(cause instanceof ApiError ? cause.message : "Could not find customers."); })
        .finally(() => { if (active) setSearching(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [accessToken, canUpload, search]);

  const sites = targets.find((target) => target.id === customerId)?.sites ?? [];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !customerId || !sites.some((site) => site.id === siteId) || !reportTypeCode || !sourceType || !file) return;
    setBusy(true);
    setUploadError(null);
    setMessage(null);
    try {
      const result = await uploadDirectServiceReport(accessToken, customerId, { siteId, reportTypeCode, sourceType, file, idempotencyKey });
      setMessage(`Service Report ${result.serviceReportNumber} uploaded for Super Admin review.`);
      setIdempotencyKey(crypto.randomUUID());
      setFile(null);
      setReportTypeCode("");
      setSourceType("");
      await load();
    } catch (cause) {
      setUploadError(cause instanceof ApiError ? cause.message : "Could not upload the report. A connection is required for direct uploads.");
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null;
  return <main style={page}>
    <button style={secondaryButton} onClick={() => router.push("/home")}>← My Jobs</button>
    <h1 style={{ ...heading, marginTop: 20 }}>My Service Reports</h1>
    <p style={subheading}>Reports you submitted, including visits without a Work Order.</p>
    {!canRead && <p style={dangerText}>Your account cannot view submitted reports.</p>}
    {canRead && <section style={{ marginTop: 24 }}>
      <h2 style={{ fontSize: 18 }}>Submitted reports</h2>
      {loading && <p style={subheading}>Loading reports…</p>}
      {listError && <p role="alert" style={dangerText}>{listError}</p>}
      {reports?.length === 0 && <p style={subheading}>No submitted reports yet.</p>}
      {reports?.map((report) => <div key={report.id} style={card}>
        <strong>{report.serviceReportNumber}</strong>
        <p style={{ ...subheading, margin: "6px 0 0" }}>{formatCode(report.reportTypeCode)} · {report.workOrderId ? "Work Order report" : "Direct report"} · {formatCode(report.status)}</p>
        <p style={{ ...subheading, margin: "4px 0 0" }}>Uploaded {formatDateTime(report.uploadedAt)}</p>
        <details style={{ marginTop: 8 }}><summary style={{ cursor: "pointer", color: colors.greenDark }}>File details</summary><p style={subheading}>File: {report.documentFileName ?? "Unavailable"}</p></details>
      </div>)}
    </section>}
    {canUpload && <section style={{ ...card, marginTop: 24 }}>
      <h2 style={{ fontSize: 18, marginTop: 0 }}>Upload direct report</h2>
      <p style={subheading}>Use this only for a legitimate visit without a linked Work Order. A connection is required to upload.</p>
      <form onSubmit={submit} style={{ display: "grid", gap: 16 }}>
        <label>Find customer<input style={control} value={search} onChange={(event) => { setSearch(event.target.value); setCustomerId(""); setSiteId(""); }} placeholder="Enter at least 2 characters" /></label>
        {searching && <p role="status" style={subheading}>Searching customers…</p>}
        {searched && !searching && targets.length === 0 && <p role="status" style={subheading}>No customers found. Try a different name.</p>}
        {searchError && <p role="alert" style={dangerText}>{searchError}</p>}
        <label>Customer<select style={control} required value={customerId} onChange={(event) => { setCustomerId(event.target.value); setSiteId(""); }}><option value="">Select customer</option>{targets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</select></label>
        <label>Site<select style={control} required value={siteId} onChange={(event) => setSiteId(event.target.value)}><option value="">Select site</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.label}</option>)}</select></label>
        <label>Report type<select style={control} required value={reportTypeCode} onChange={(event) => setReportTypeCode(event.target.value)}><option value="">Select type</option>{types.map((type) => <option key={type.code} value={type.code}>{type.label}</option>)}</select></label>
        {typesLoading && <p role="status" style={subheading}>Loading report types…</p>}
        {typesError && <div><p role="alert" style={dangerText}>{typesError}</p><button type="button" style={secondaryButton} onClick={() => void loadTypes()}>Retry report types</button></div>}
        <label>Reason for direct report<select style={control} required value={sourceType} onChange={(event) => setSourceType(event.target.value)}><option value="">Select reason</option>{reasons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <div>
          <label>Signed report (PDF or image, up to 25 MB)<input key={idempotencyKey} style={control} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
          <input key={idempotencyKey} ref={cameraInputRef} type="file" accept={cameraMimeTypes} capture="environment" aria-label="Camera photo" style={{ display: "none" }} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          <button type="button" style={{ ...secondaryButton, marginTop: 8 }} onClick={() => cameraInputRef.current?.click()}>Take Photo</button>
          {file && <p role="status" style={{ ...subheading, margin: "8px 0 0" }}>Selected report: {file.name}</p>}
        </div>
        <button type="submit" style={secondaryButton} disabled={busy || !customerId || !siteId || !file}>{busy ? "Uploading…" : "Upload report"}</button>
      </form>
    </section>}
    {uploadError && <p role="alert" style={dangerText}>{uploadError}</p>}
    {message && <p role="status" style={{ color: colors.green }}>{message}</p>}
  </main>;
}
