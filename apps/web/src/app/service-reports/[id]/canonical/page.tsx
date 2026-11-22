"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { getCanonicalServiceReport, lockServiceReport, type CanonicalServiceReportView } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, LoadingState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate, formatDateTime, formatTime } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LockReportDialog } from "@/components/service-reports/lock-report-dialog";

function fmt(value: string | null): string {
  return value === null || value === "" ? "—" : value;
}

/**
 * Phase 5 Step 6 — minimal read-only canonical Service Report viewer
 * (approved Decision 8). Gated on service_reports.read, matching the
 * backend's GET .../canonical route — deliberately the same broad "view any
 * Service Report" permission as the verification queue, not
 * service_reports.confirm, since inspecting already-confirmed data needs no
 * confirm authority. No editing, no equipment history, no dashboards — just
 * what was actually written to the canonical tables.
 */
export default function CanonicalServiceReportPage() {
  const params = useParams<{ id: string }>();
  const { accessToken, hasPermission, isLoading: authLoading } = useAuth();
  const [view, setView] = useState<CanonicalServiceReportView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canRead = hasPermission("service_reports", "read") || hasPermission("service_reports", "read_assigned");
  const canLock = hasPermission("service_reports", "lock");

  const load = useCallback(async () => {
    if (!accessToken || !canRead) return;
    setError(null);
    setView(null);
    try {
      setView(await getCanonicalServiceReport(accessToken, params.id));
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? "Access denied to this Service Report." : e instanceof ApiError ? e.message : "Failed to load the canonical Service Report.");
    }
  }, [accessToken, canRead, params.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleLock() {
    if (!accessToken) return;
    await lockServiceReport(accessToken, params.id);
    await load(); // re-fetch — status is now LOCKED
  }

  if (authLoading) return <LoadingState />;
  if (!canRead) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <ErrorState message="You do not have permission to view Service Reports." />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <Breadcrumbs
        items={[{ label: "Service Reports", href: "/service-reports" }, { label: "Verify", href: `/service-reports/${params.id}/verify` }, { label: "Canonical" }]}
      />
      <PageHeader className="mb-0"
        title={view ? `Service Report ${view.report.serviceReportNumber}` : "Canonical Service Report"}
        description={view?.report.reportTypeOther ? `${view.report.reportTypeOther} · Official confirmed data — read-only.` : "Official confirmed data — read-only."}
        actions={
          view ? (
            <>
              {canLock && view.report.status === "CONFIRMED" && <LockReportDialog onLock={handleLock} />}
              <StatusBadge status={view.report.status} />
            </>
          ) : undefined
        }
      />

      {error && <ErrorState message={error} onRetry={load} />}
      {!view && !error && <LoadingState label="Loading canonical report…" />}

      {view && (
        <>
          <Card>
            <CardHeader><CardTitle>Approval history</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>First review: {view.report.verifiedByName ?? "Recorded reviewer"}{view.report.verifiedAt ? ` · ${formatDateTime(view.report.verifiedAt)}` : ""}</p>
              <p>Final approval: {view.report.confirmedByName ?? "Recorded approver"}{view.report.confirmedAt ? ` · ${formatDateTime(view.report.confirmedAt)}` : ""}</p>
              {view.report.lockedAt && <p>Locked by: {view.report.lockedByName ?? "Recorded administrator"} · {formatDateTime(view.report.lockedAt)}</p>}
              {hasPermission("service_reports", "verify") && <Link href={`/service-reports/${params.id}/verify`} className="inline-block text-primary underline-offset-2 hover:underline">View original document and review history</Link>}
            </CardContent>
          </Card>
          {view.report.verificationBasis === "DOCUMENT_ONLY" ? <Card>
            <CardHeader><CardTitle>Approved original document</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">This report was reviewed and approved using the original uploaded document. Structured equipment and measurement fields were not extracted.</CardContent>
          </Card> :
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <span className="text-muted-foreground">Service Date:</span> {formatDate(view.report.serviceDate)}
              </div>
              <div>
                <span className="text-muted-foreground">Reference Number:</span> {fmt(view.report.reportReferenceNumber)}
              </div>
              <div>
                <span className="text-muted-foreground">Time In:</span> {formatTime(view.report.timeIn)}
              </div>
              <div>
                <span className="text-muted-foreground">Time Out:</span> {formatTime(view.report.timeOut)}
              </div>
              <div>
                <span className="text-muted-foreground">Contact Name:</span> {fmt(view.report.contactName)}
              </div>
              <div>
                <span className="text-muted-foreground">Contact Phone:</span> {fmt(view.report.contactPhone)}
              </div>
              {view.report.generalNotes && (
                <div className="sm:col-span-2">
                  <span className="text-muted-foreground">General Notes:</span>
                  <p className="mt-1 whitespace-pre-wrap">{view.report.generalNotes}</p>
                </div>
              )}
            </CardContent>
          </Card>}

          {view.technicians.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Technicians ({view.technicians.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-inside list-disc text-sm">
                  {view.technicians.map((t) => (
                    <li key={t.id}>{t.technicianName}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {view.equipmentUnits.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Equipment Units ({view.equipmentUnits.length})</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                {view.equipmentUnits.map((u) => (
                  <div key={u.id} className="rounded-md border p-3">
                    <p className="font-medium text-foreground">
                      {fmt(u.unitTag)} <span className="ml-2 text-xs uppercase tracking-wide text-muted-foreground">{u.equipmentTypeCode}</span>
                    </p>
                    <p className="mt-1 text-muted-foreground">{u.description}</p>
                    {(u.location || u.modelNumber || u.serialNumber) && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {u.location && <>Location: {u.location} · </>}
                        {u.modelNumber && <>Model: {u.modelNumber} · </>}
                        {u.serialNumber && <>Serial: {u.serialNumber}</>}
                      </p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {view.problems.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Problems / Checklist ({view.problems.length})</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                {view.problems.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                    <span>{p.description}</span>
                    {p.problemTypeCode && <span className="text-xs uppercase tracking-wide text-muted-foreground">{p.problemTypeCode}</span>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {view.measurements.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Measurements / Technical Data ({view.measurements.length})</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                {view.measurements.map((m) => (
                  <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                    <span className="font-medium text-foreground">{m.sourceFieldName ?? m.measurementTypeCode}</span>
                    <span className="font-mono">
                      {m.value}
                      {m.unit ? ` ${m.unit}` : ""}
                    </span>
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      {m.measurementTypeCode}
                      {m.stageCode ? ` · ${m.stageCode}` : ""}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {view.narrativeItems.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Narrative / Findings / Recommendations ({view.narrativeItems.length})</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                {view.narrativeItems.map((n) => (
                  <div key={n.id} className="rounded-md border p-2">
                    {n.category && <p className="text-xs uppercase tracking-wide text-muted-foreground">{n.category}</p>}
                    <p>{n.description}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {view.signoffs.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Signoffs ({view.signoffs.length})</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                {view.signoffs.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">{s.signoffRoleCode}</span>
                    <span>{s.signed ? fmt(s.signatoryName) : "Not signed"}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
