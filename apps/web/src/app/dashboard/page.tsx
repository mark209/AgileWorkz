"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import {
  listAuditLogs,
  listCustomers,
  listQuotations,
  listServiceReports,
  listWorkOrders,
  type AuditLogEntry,
  type Customer,
  type Quotation,
  type ServiceReportListItem,
  type WorkOrder,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { RecentActivityList } from "@/components/dashboard/recent-activity-list";
import { StatusBadge } from "@/components/shared/status-badge";

interface SectionState<T> {
  data: T | null;
  error: string | null;
}
const initialSection = { data: null, error: null };

/**
 * Phase 6 (Dashboard) — a ground-up rebuild of what was a Phase 1 stub
 * (inline styles, no design-system components, stale "Sales and Operations
 * screens land in later phases" copy). Every section below is gated on an
 * existing module permission — nothing new was added to RBAC — and is
 * simply omitted (not rendered, not shown empty/greyed) when the viewer
 * lacks it. No new "dashboard" permission exists or is checked anywhere in
 * this file. No chart library, no date-range filter, no aggregate
 * table/endpoint: every number here is a client-side count over rows
 * fetched from an existing (or, for quotations/work orders, newly added
 * but permission-identical) list endpoint.
 */
export default function DashboardPage() {
  const { user, accessToken, hasPermission, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const managerView = !!user?.roles.includes("Manager") && !user.roles.includes("Admin/Owner");
  const officeView = !!user?.roles.includes("Office Staff") && !managerView && !user.roles.includes("Admin/Owner");
  const technicianView = !!user?.roles.includes("Technician") && !managerView && !officeView && !user.roles.includes("Admin/Owner");
  const adminView = !!user?.roles.includes("Admin/Owner");

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  const canReadCustomers = hasPermission("customers", "read");
  const canReadServiceReports = hasPermission("service_reports", "read") || hasPermission("service_reports", "read_assigned");
  const canReadQuotations = hasPermission("quotations", "read");
  const canReadWorkOrders = hasPermission("work_orders", "read") || hasPermission("work_orders", "read_assigned") || hasPermission("work_orders", "read_own");
  const canReadAudit = !managerView && hasPermission("audit_logs", "read");
  const canApproveQuotations = hasPermission("quotations", "approve");
  const canApproveFinal = hasPermission("quotations", "approve_final");
  const canVerifyReports = canReadServiceReports && hasPermission("service_reports", "verify");
  const canCancelWorkOrders = hasPermission("work_orders", "cancel");

  const [customers, setCustomers] = useState<SectionState<Customer[]>>(initialSection);
  const [serviceReports, setServiceReports] = useState<SectionState<ServiceReportListItem[]>>(initialSection);
  const [quotations, setQuotations] = useState<SectionState<Quotation[]>>(initialSection);
  const [workOrders, setWorkOrders] = useState<SectionState<WorkOrder[]>>(initialSection);
  const [auditLogs, setAuditLogs] = useState<SectionState<AuditLogEntry[]>>(initialSection);

  const load = useCallback(async () => {
    if (!accessToken) return;
    const requests: Promise<void>[] = [];
    if (canReadCustomers) {
      setCustomers(initialSection);
      requests.push(listCustomers(accessToken).then((data) => setCustomers({ data, error: null }))
        .catch((e) => setCustomers({ data: null, error: e instanceof ApiError ? e.message : "Failed to load customers." })));
    }

    if (canReadServiceReports) {
      setServiceReports(initialSection);
      requests.push(listServiceReports(accessToken, "PENDING_VERIFICATION,VERIFIED,CONFIRMED").then((data) => setServiceReports({ data, error: null }))
        .catch((e) => setServiceReports({ data: null, error: e instanceof ApiError ? e.message : "Failed to load service reports." })));
    }

    if (canReadQuotations) {
      setQuotations(initialSection);
      requests.push(listQuotations(accessToken, "PENDING_APPROVAL,PENDING_OWNER_APPROVAL,SENT").then((data) => setQuotations({ data, error: null }))
        .catch((e) => setQuotations({ data: null, error: e instanceof ApiError ? e.message : "Failed to load quotations." })));
    }

    if (canReadWorkOrders) {
      setWorkOrders(initialSection);
      requests.push(listWorkOrders(accessToken, managerView || technicianView ? undefined : "SCHEDULED,IN_PROGRESS", managerView).then((data) => setWorkOrders({ data, error: null }))
        .catch((e) => setWorkOrders({ data: null, error: e instanceof ApiError ? e.message : "Failed to load work orders." })));
    }

    if (canReadAudit) {
      setAuditLogs(initialSection);
      requests.push(listAuditLogs(accessToken, 8).then((data) => setAuditLogs({ data, error: null }))
        .catch((e) => setAuditLogs({ data: null, error: e instanceof ApiError ? e.message : "Failed to load recent activity." })));
    }
    await Promise.all(requests);
  }, [accessToken, canReadCustomers, canReadServiceReports, canReadQuotations, canReadWorkOrders, canReadAudit, managerView, technicianView]);

  useEffect(() => {
    load();
  }, [load]);

  if (authLoading || !user) return <LoadingState />;

  const hasAnySection = canReadCustomers || canReadServiceReports || canReadQuotations || canReadWorkOrders || canReadAudit;

  // One shared loading/error handler per section, so a slow or failed
  // fetch for one module (e.g. Quotations) never blocks or hides the
  // sections the viewer DOES have working data for.
  function section<T>(state: SectionState<T>, render: (data: T) => ReactNode): ReactNode {
    if (state.error) return <ErrorState message={state.error} onRetry={load} />;
    if (state.data === null) return <LoadingState label="Loading…" />;
    return render(state.data);
  }

  const attentionItems = [
    ...(canApproveQuotations ? (quotations.data ?? []).filter((q) => q.status === "PENDING_APPROVAL").map((q) => ({
      id: q.id, label: `${q.quotationNumber} · Manager review`, href: `/quotations/${q.id}`,
    })) : []),
    ...(canApproveFinal ? (quotations.data ?? []).filter((q) => q.status === "PENDING_OWNER_APPROVAL").map((q) => ({
      id: q.id, label: `${q.quotationNumber} · Owner review`, href: `/quotations/${q.id}`,
    })) : []),
    ...(canVerifyReports ? (serviceReports.data ?? []).filter((r) => r.status === "PENDING_VERIFICATION").map((r) => ({
      id: r.id, label: `${r.serviceReportNumber} · Verify report`, href: `/service-reports/${r.id}/verify`,
    })) : []),
    ...(canCancelWorkOrders ? (workOrders.data ?? []).filter((w) => w.cancellationRequestedAt !== null && w.cancelledAt === null).map((w) => ({
      id: w.id, label: `${w.workOrderNumber} · Cancellation request`, href: `/work-orders/${w.id}`,
    })) : []),
  ].slice(0, 6);
  const attentionLoading = (canApproveQuotations || canApproveFinal) && quotations.data === null && !quotations.error
    || canVerifyReports && serviceReports.data === null && !serviceReports.error
    || canCancelWorkOrders && workOrders.data === null && !workOrders.error;
  const attentionError = (canApproveQuotations || canApproveFinal) && quotations.error
    || canVerifyReports && serviceReports.error
    || canCancelWorkOrders && workOrders.error;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6">
      <PageHeader title={managerView ? "Manager Dashboard" : officeView ? "Office Staff Dashboard" : technicianView ? "Technician Dashboard" : adminView ? "Super Admin Dashboard" : "Dashboard"} description={`Welcome, ${user.fullName}. ${managerView || technicianView ? "Review services assigned to you." : "Review current work and recent changes."}`} actions={managerView && hasPermission("work_orders", "create") ? <Link href="/customers" className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Choose customer to create Service</Link> : technicianView && canReadWorkOrders ? <Link href="/work-orders" className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">View assigned services</Link> : undefined} />

      {!hasAnySection && (
        <p className="text-sm text-muted-foreground">
          Your account has no operational Dashboard sections to display for your current role.
        </p>
      )}

      {(canApproveQuotations || canApproveFinal || canVerifyReports || canCancelWorkOrders || canReadAudit) && (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
          {(canApproveQuotations || canApproveFinal || canVerifyReports || canCancelWorkOrders) && (
            <Card>
              <CardHeader><CardTitle>Needs Attention</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {attentionItems.map((item) => <Link key={item.id} className="flex items-center justify-between rounded-md border px-3 py-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={item.href}><span>{item.label}</span><span className="ml-3 font-medium">Open →</span></Link>)}
                {attentionLoading && <LoadingState label="Loading items needing attention…" />}
                {attentionError && <ErrorState message="Some items could not be loaded." onRetry={load} />}
                {!attentionLoading && !attentionError && attentionItems.length === 0 && <p className="text-muted-foreground">No items currently need your attention.</p>}
              </CardContent>
            </Card>
          )}
          {canReadAudit && (
            <Card>
              <CardHeader><CardTitle>Recent Activity</CardTitle></CardHeader>
              <CardContent>
                {section(auditLogs, (data) =>
                  data.length === 0 ? (
                    <EmptyState title="No recent activity" description="Nothing has been logged yet." />
                  ) : (
                    <RecentActivityList entries={data} />
                  ),
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {(managerView || technicianView) && canReadWorkOrders && (
        <Card>
          <CardHeader><CardTitle>My Assigned Services</CardTitle></CardHeader>
          <CardContent>
            {section(workOrders, (data) => data.length === 0 ? (
              <EmptyState title="No assigned services" description="Work Orders explicitly assigned to you will appear here." />
            ) : (
              <ul className="space-y-2">
                {data.slice(0, 5).map((workOrder) => (
                  <li key={workOrder.id} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium">{workOrder.workOrderNumber}</p>
                      <p className="text-sm text-muted-foreground">{workOrder.customer.name} · {workOrder.site.label}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={workOrder.status} />
                      <Link href={`/work-orders/${workOrder.id}`} className="text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">View Service</Link>
                    </div>
                  </li>
                ))}
              </ul>
            ))}
          </CardContent>
        </Card>
      )}

      {(canReadCustomers || canReadServiceReports || canReadQuotations || canReadWorkOrders) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {canReadCustomers &&
            section(customers, (data) => (
              <KpiCard label="Active Customers" value={data.filter((c) => c.status === "ACTIVE").length} href="/customers" />
            ))}

          {canReadServiceReports &&
            section(serviceReports, (data) => (
              <>
                <KpiCard
                  label="Service Reports — Pending Verification"
                  value={data.filter((r) => r.status === "PENDING_VERIFICATION").length}
                  href="/service-reports"
                />
                <KpiCard label="Service Reports — Verified" value={data.filter((r) => r.status === "VERIFIED").length} href="/service-reports" />
                <KpiCard label="Service Reports — Confirmed" value={data.filter((r) => r.status === "CONFIRMED").length} href="/service-reports" />
              </>
            ))}

          {canReadQuotations &&
            section(quotations, (data) => (
              <>
                <KpiCard
                  label="Quotations — Pending Approval"
                  value={data.filter((q) => q.status === "PENDING_APPROVAL").length}
                  href="/quotations?status=PENDING_APPROVAL"
                />
                <KpiCard
                  label="Quotations — Pending Owner Approval"
                  value={data.filter((q) => q.status === "PENDING_OWNER_APPROVAL").length}
                  href="/quotations?status=PENDING_OWNER_APPROVAL"
                />
                <KpiCard
                  label="Quotations — Awaiting Customer Decision"
                  value={data.filter((q) => q.status === "SENT").length}
                  href="/quotations?status=SENT"
                />
              </>
            ))}

          {canReadWorkOrders &&
            section(workOrders, (data) => (
              <>
                <KpiCard
                  label="Work Orders — Scheduled"
                  value={data.filter((w) => w.status === "SCHEDULED").length}
                  href={`/work-orders?status=SCHEDULED${managerView ? "&scope=assigned" : ""}`}
                />
                <KpiCard
                  label="Work Orders — In Progress"
                  value={data.filter((w) => w.status === "IN_PROGRESS").length}
                  href={`/work-orders?status=IN_PROGRESS${managerView ? "&scope=assigned" : ""}`}
                />
                <KpiCard
                  label="Work Orders — Cancellation Requested"
                  value={data.filter((w) => w.cancellationRequestedAt !== null && w.cancelledAt === null).length}
                  href={`/work-orders?status=SCHEDULED,IN_PROGRESS${managerView ? "&scope=assigned" : ""}`}
                />
              </>
            ))}
        </div>
      )}

    </div>
  );
}
