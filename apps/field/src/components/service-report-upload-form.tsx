"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { listServiceReportTypes, uploadServiceReport, type ServiceReportType, type WorkOrder } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { colors, dangerText, input, label, primaryButton } from "@/lib/styles";

const ACCEPTED_MIME_TYPES = "application/pdf,image/jpeg,image/png,image/webp";

// Phase 7 Wave 1 (F6.2, scoped mitigation) — apps/field's tokens are
// in-memory only (a deliberate, unchanged Phase 1 security choice), so a
// reload or an OS-killed background tab logs the technician out and wipes
// all React state. The chosen file itself can never survive that (a File
// object isn't serializable), but the report-type selection can — a small
// thing, but it's one less field to re-fill after re-logging in mid-job.
// Never touches business lifecycle rules: this is purely a client-side
// convenience keyed by Work Order id, read once on mount and cleared the
// moment an upload actually succeeds.
function draftKey(workOrderId: string): string {
  return `sr-upload-draft:${workOrderId}`;
}

function readDraftReportType(workOrderId: string): string {
  try {
    return sessionStorage.getItem(draftKey(workOrderId)) ?? "";
  } catch {
    return "";
  }
}

function writeDraftReportType(workOrderId: string, reportTypeCode: string): void {
  try {
    if (reportTypeCode) sessionStorage.setItem(draftKey(workOrderId), reportTypeCode);
    else sessionStorage.removeItem(draftKey(workOrderId));
  } catch {
    // Private browsing / storage disabled — the form still works, it just
    // won't survive a reload. Never let a storage failure break upload.
  }
}

/**
 * Phase 4 Operations Frontend — uploads a Service Report against this Work
 * Order and hands off entirely into Phase 5's existing pipeline
 * (POST /customers/:id/service-reports -> upload -> extraction ->
 * verification -> confirmation -> lock). Nothing about that pipeline is
 * duplicated here: this form's only job is collecting the three upload-time
 * fields the DTO actually accepts (reportTypeCode, siteId, workOrderId) plus
 * the file, then showing the resulting Service Report number.
 */
export function ServiceReportUploadForm({ workOrder }: { workOrder: WorkOrder }) {
  const { accessToken, hasPermission } = useAuth();
  const canUpload = hasPermission("service_reports", "upload");

  const [types, setTypes] = useState<ServiceReportType[] | null>(null);
  const [typesError, setTypesError] = useState<string | null>(null);
  const [reportTypeCode, setReportTypeCodeState] = useState(() => readDraftReportType(workOrder.id));
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<string | null>(null);

  function setReportTypeCode(value: string) {
    setReportTypeCodeState(value);
    writeDraftReportType(workOrder.id, value);
  }

  const loadTypes = useCallback(async () => {
    if (!accessToken || !canUpload) return;
    setTypesError(null);
    try {
      setTypes(await listServiceReportTypes(accessToken));
    } catch (e) {
      setTypesError(e instanceof ApiError ? e.message : "Failed to load report types.");
    }
  }, [accessToken, canUpload]);

  useEffect(() => {
    loadTypes();
  }, [loadTypes]);

  if (!canUpload) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken || !reportTypeCode || !file) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await uploadServiceReport(accessToken, workOrder.customerId, {
        siteId: workOrder.siteId,
        workOrderId: workOrder.id,
        reportTypeCode,
        file,
      });
      setUploaded(result.serviceReportNumber);
      setReportTypeCode(""); // also clears the persisted draft, via the wrapper above
      setFile(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to upload Service Report.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {uploaded && (
        <p style={{ color: colors.green, fontWeight: 600 }}>
          Uploaded — {uploaded}. Your office will verify it from here; you can upload another if you have more paperwork for this job.
        </p>
      )}

      {typesError && <p style={dangerText}>{typesError}</p>}
      {!typesError && types === null && <p style={{ color: colors.textMuted }}>Loading report types…</p>}

      {!typesError && types !== null && (
        <>
          <label style={label} htmlFor="sr-report-type">
            Report type
          </label>
          <select id="sr-report-type" style={input} value={reportTypeCode} onChange={(e) => setReportTypeCode(e.target.value)}>
            <option value="" disabled>
              Select a report type…
            </option>
            {types.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
          </select>

          <label style={label} htmlFor="sr-file">
            Photo or document
          </label>
          <input
            id="sr-file"
            type="file"
            style={input}
            accept={ACCEPTED_MIME_TYPES}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />

          {error && <p style={{ ...dangerText, marginTop: 12 }}>{error}</p>}

          <button type="submit" style={{ ...primaryButton, width: "100%", marginTop: 16 }} disabled={submitting || !reportTypeCode || !file}>
            {submitting ? "Uploading…" : "Upload Service Report"}
          </button>
        </>
      )}
    </form>
  );
}
