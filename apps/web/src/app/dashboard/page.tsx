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
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { RecentActivityList } from "@/components/dashboard/recent-activity-list";
import { WorkflowOverview } from "@/components/dashboard/workflow-overview";
import { StatusBadge } from "@/components/shared/status-badge";
import { ContentReveal, DashboardSkeleton, Skeleton } from "@/components/shared/skeleton";

interface SectionState<T> {
  data: T | null;
  error: string | null;
}
const initialSection = { data: null, error: null };

function AttentionList({ items, loading, error, onRetry, emptyMessage }: {
  items: Array<{ id: string; label: string; href: string }>;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  emptyMessage: string;
}) {
  const [page, setPage] = useState(1);
  const itemsKey = items.map((item) => `${item.href}:${item.label}`).join("\n");
  useEffect(() => { setPage(1); }, [itemsKey]);
  const pageCount = Math.max(1, Math.ceil(items.length / 5));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * 5;

  return <>
    {items.slice(start, start + 5).map((item) => <Link key={item.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={item.href}><span className="min-w-0 break-words">{item.label}</span><span className="shrink-0 font-medium text-primary">Open →</span></Link>)}
    {loading && <LoadingState label="Loading items needing attention…" />}
    {error && <ErrorState message="Some items could not be loaded." onRetry={onRetry} />}
    {!loading && !error && items.length === 0 && <p className="text-muted-foreground">{emptyMessage}</p>}
    {items.length > 0 && <nav aria-label="Needs Attention pages" className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground">Showing {start + 1}–{Math.min(start + 5, items.length)} of {items.length} · Page {currentPage} of {pageCount}</p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</Button>
        <Button type="button" variant="outline" size="sm" aria-label="Next page" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next</Button>
      </div>
    </nav>}
  </>;
}

function technicianNextStep(status: WorkOrder["status"]): string {
  if (status === "DRAFT") return "Draft Work Order. Ask the responsible team to move it to Scheduled before starting.";
  if (status === "SCHEDULED") return "Open this Work Order to start the job.";
  if (status === "IN_PROGRESS") return "Open this Work Order to upload your Service Report when work is done.";
  if (status === "COMPLETED") return "Open this Work Order if another Service Report is needed while your assignment remains active.";
  return "View the Work Order for its current status.";
}

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
  const canApproveReports = canVerifyReports && (hasPermission("service_reports", "technical_approve") || hasPermission("service_reports", "document_approve"));
  const canReviewReports = canVerifyReports;
  const canConfirmReports = canVerifyReports && hasPermission("service_reports", "confirm");
  const canActOnReports = canReviewReports || canConfirmReports;
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
      requests.push(listQuotations(accessToken, "PENDING_APPROVAL,PENDING_OWNER_APPROVAL,SENT,ACCEPTED").then((data) => setQuotations({ data, error: null }))
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

  if (authLoading || !user) return <DashboardSkeleton />;

  const hasAnySection = canReadCustomers || canReadServiceReports || canReadQuotations || canReadWorkOrders || canReadAudit;

  // One shared loading/error handler per section, so a slow or failed
  // fetch for one module (e.g. Quotations) never blocks or hides the
  // sections the viewer DOES have working data for.
  function section<T>(state: SectionState<T>, render: (data: T) => ReactNode): ReactNode {
    if (state.error) return <ErrorState message={state.error} onRetry={load} />;
    if (state.data === null) return <div role="status" aria-label="Loading section" className="space-y-3 py-2"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-5 w-full" /><Skeleton className="h-5 w-4/5" /></div>;
    return <ContentReveal>{render(state.data)}</ContentReveal>;
  }

  const attentionItems = [
    ...(canApproveQuotations ? (quotations.data ?? []).filter((q) => q.status === "PENDING_APPROVAL").map((q) => ({
      id: q.id, label: `${q.quotationNumber} · Manager review`, href: `/quotations/${q.id}`,
    })) : []),
    ...(canApproveFinal ? (quotations.data ?? []).filter((q) => q.status === "PENDING_OWNER_APPROVAL").map((q) => ({
      id: q.id, label: `${q.quotationNumber} · Owner review`, href: `/quotations/${q.id}`,
    })) : []),
    ...(canReviewReports ? (serviceReports.data ?? []).filter((r) => r.status === "PENDING_VERIFICATION").map((r) => ({
      id: r.id, label: `${r.serviceReportNumber} · ${canApproveReports ? "Supervisor review" : "Review report"}`, href: `/service-reports/${r.id}/verify`,
    })) : []),
    ...(canConfirmReports ? (serviceReports.data ?? []).filter((r) => r.status === "VERIFIED").map((r) => ({
      id: r.id, label: `${r.serviceReportNumber} · Final approval`, href: `/service-reports/${r.id}/verify`,
    })) : []),
    ...(canCancelWorkOrders ? (workOrders.data ?? []).filter((w) => w.cancellationRequestedAt !== null && w.cancelledAt === null).map((w) => ({
      id: w.id, label: `${w.workOrderNumber} · Cancellation request`, href: `/work-orders/${w.id}`,
    })) : []),
  ];
  const attentionLoading = (canApproveQuotations || canApproveFinal) && quotations.data === null && !quotations.error
    || canActOnReports && serviceReports.data === null && !serviceReports.error
    || canCancelWorkOrders && workOrders.data === null && !workOrders.error;
  const attentionError = (canApproveQuotations || canApproveFinal) && quotations.error
    || canActOnReports && serviceReports.error
    || canCancelWorkOrders && workOrders.error;

  if (adminView) {
    return (
      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <PageHeader className="mb-0" title="Dashboard" description="Overview of your business operations" />

        {!hasAnySection && (
          <p className="text-sm text-muted-foreground">
            Your account has no operational Dashboard sections to display for your current role.
          </p>
        )}

        {(canReadCustomers || canReadQuotations || canReadWorkOrders || canVerifyReports) && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {canReadCustomers && section(customers, (data) => (
              <KpiCard compact label="Active Customers" value={data.filter((c) => c.status === "ACTIVE").length} href="/customers" />
            ))}
            {canReadQuotations && section(quotations, (data) => (
              <KpiCard compact label="Pending Approvals" value={data.filter((q) => q.status === "PENDING_APPROVAL" || q.status === "PENDING_OWNER_APPROVAL").length} href="/quotations?status=PENDING_APPROVAL,PENDING_OWNER_APPROVAL" />
            ))}
            {canReadWorkOrders && section(workOrders, (data) => (
              <KpiCard compact label="Active Work Orders" value={data.filter((w) => w.status === "SCHEDULED" || w.status === "IN_PROGRESS").length} href="/work-orders?status=SCHEDULED,IN_PROGRESS" />
            ))}
            {canVerifyReports && section(serviceReports, (data) => (
              <KpiCard compact label="Reports to Verify" value={data.filter((r) => r.status === "PENDING_VERIFICATION").length} href="/service-reports?status=PENDING_VERIFICATION" />
            ))}
          </div>
        )}

        {(canApproveQuotations || canApproveFinal || canActOnReports || canCancelWorkOrders) && (
          <Card className="shadow-none">
            <CardHeader className="p-4 pb-2 sm:px-5"><h2 className="text-base font-semibold">Needs Attention</h2></CardHeader>
            <CardContent className="space-y-2 px-4 pb-4 pt-0 text-sm sm:px-5">
              <AttentionList items={attentionItems} loading={attentionLoading} error={!!attentionError} onRetry={load} emptyMessage="No items currently require your attention." />
            </CardContent>
          </Card>
        )}

        {(canReadQuotations || canReadWorkOrders || canReadServiceReports || canReadAudit) && (
          <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
            {(canReadQuotations || canReadWorkOrders || canReadServiceReports) && (
              <Card className="min-w-0 shadow-none">
                <CardHeader className="p-4 pb-2 sm:px-5"><h2 className="text-base font-semibold">Workflow Overview</h2></CardHeader>
                <CardContent className="divide-y px-4 pb-4 pt-0 sm:px-5">
                  {canReadQuotations && section(quotations, (data) => <WorkflowOverview groups={[{
                    label: "Quotations",
                    statuses: [
                      { label: "Pending Manager Approval", count: data.filter((q) => q.status === "PENDING_APPROVAL").length, href: "/quotations?status=PENDING_APPROVAL" },
                      { label: "Pending Owner Approval", count: data.filter((q) => q.status === "PENDING_OWNER_APPROVAL").length, href: "/quotations?status=PENDING_OWNER_APPROVAL" },
                      { label: "Sent", count: data.filter((q) => q.status === "SENT").length, href: "/quotations?status=SENT" },
                      { label: "Accepted", count: data.filter((q) => q.status === "ACCEPTED").length, href: "/quotations?status=ACCEPTED" },
                    ],
                  }]} />)}
                  {canReadWorkOrders && section(workOrders, (data) => <WorkflowOverview groups={[{
                    label: "Work Orders",
                    statuses: [
                      { label: "Scheduled", count: data.filter((w) => w.status === "SCHEDULED").length, href: "/work-orders?status=SCHEDULED" },
                      { label: "In Progress", count: data.filter((w) => w.status === "IN_PROGRESS").length, href: "/work-orders?status=IN_PROGRESS" },
                      { label: "Cancellation Requested", count: data.filter((w) => w.cancellationRequestedAt !== null && w.cancelledAt === null).length },
                    ],
                  }]} />)}
                  {canReadServiceReports && section(serviceReports, (data) => <WorkflowOverview groups={[{
                    label: "Service Reports",
                    statuses: [
                      { label: "Pending Verification", count: data.filter((r) => r.status === "PENDING_VERIFICATION").length, href: "/service-reports?status=PENDING_VERIFICATION" },
                      { label: "Verified", count: data.filter((r) => r.status === "VERIFIED").length, href: "/service-reports?status=VERIFIED" },
                      { label: "Confirmed", count: data.filter((r) => r.status === "CONFIRMED").length, href: "/service-reports?status=CONFIRMED" },
                    ],
                  }]} />)}
                </CardContent>
              </Card>
            )}
            {canReadAudit && (
              <Card className="min-w-0 shadow-none">
                <CardHeader className="p-4 pb-2 sm:px-5"><h2 className="text-base font-semibold">Recent Activity</h2></CardHeader>
                <CardContent className="px-4 pb-4 pt-0 sm:px-5">
                  {section(auditLogs, (data) => data.length === 0
                    ? <p className="text-sm text-muted-foreground">No recent activity.</p>
                    : <RecentActivityList entries={data} />)}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </main>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader className="mb-0" title={managerView ? "Manager Dashboard" : officeView ? "Office Staff Dashboard" : technicianView ? "Technician Dashboard" : "Dashboard"} description={`Welcome, ${user.fullName}. ${managerView || technicianView ? "Review Work Orders assigned to you." : "Review your authorized work."}`} actions={managerView && hasPermission("work_orders", "create") ? <Link href="/customers" className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Choose a customer to create a Work Order</Link> : officeView && canReadCustomers ? <Link href="/customers" className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">View customers</Link> : undefined} />

      {!hasAnySection && (
        <p className="text-sm text-muted-foreground">
          Your account has no operational Dashboard sections to display for your current role.
        </p>
      )}

      {technicianView && canReadWorkOrders && section(workOrders, data => (
        <section aria-label="Assigned work summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard compact label="Assigned jobs" value={data.length} />
          <KpiCard compact label="Ready to start" value={data.filter(order => order.status === "SCHEDULED").length} />
          <KpiCard compact label="Work in progress" value={data.filter(order => order.status === "IN_PROGRESS").length} />
          <KpiCard compact label="Completed / Closed" value={data.filter(order => order.status === "COMPLETED" || order.status === "CLOSED").length} />
        </section>
      ))}

      {(canApproveQuotations || canApproveFinal || canActOnReports || canCancelWorkOrders || canReadAudit) && (
        <div className={`grid items-start gap-4 ${canReadAudit && (canApproveQuotations || canApproveFinal || canActOnReports || canCancelWorkOrders) ? "lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]" : ""}`}>
          {(canApproveQuotations || canApproveFinal || canActOnReports || canCancelWorkOrders) && (
            <Card>
              <CardHeader><CardTitle>Needs Attention</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <AttentionList items={attentionItems} loading={attentionLoading} error={!!attentionError} onRetry={load} emptyMessage="No items currently need your attention." />
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
          <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your work queue</p><CardTitle>My Assigned Work Orders</CardTitle></div><Link href="/work-orders" className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">View all assigned Work Orders →</Link></CardHeader>
          <CardContent>
            {technicianView && <p className="mb-4 text-sm text-muted-foreground">Open a Work Order to start a scheduled job or upload a report when its status permits. You can also use AgileWorks Field.</p>}
            {section(workOrders, (data) => data.length === 0 ? (
              <EmptyState title="No assigned Work Orders" description="Work Orders explicitly assigned to you will appear here." />
            ) : (
              <ul className="grid gap-4 xl:grid-cols-2">
                {data.slice(0, 5).map((workOrder) => (
                  <li key={workOrder.id} className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-3">
                      <p className="text-sm font-semibold">{workOrder.workOrderNumber}</p>
                      <StatusBadge status={workOrder.status} />
                    </div>
                    <div className="flex-1 space-y-2 p-4">
                      <p className="break-words font-medium">{workOrder.customer.name}</p>
                      <p className="break-words text-sm text-muted-foreground">{workOrder.site.label}</p>
                      <p className="text-xs text-muted-foreground">Scheduled: {formatDate(workOrder.scheduledDate)}</p>
                      {technicianView && <p className="border-t pt-3 text-sm leading-relaxed text-muted-foreground">{technicianNextStep(workOrder.status)}</p>}
                    </div>
                    <div className="border-t px-4 py-3"><Link href={`/work-orders/${workOrder.id}`} className="inline-flex min-h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">View Work Order</Link></div>
                  </li>
                ))}
              </ul>
            ))}
          </CardContent>
        </Card>
      )}

      {(canReadCustomers || canReadServiceReports || canReadQuotations || (canReadWorkOrders && !technicianView)) && (
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
                  href="/service-reports?status=PENDING_VERIFICATION"
                />
                {!officeView && <KpiCard label="Service Reports — Verified" value={data.filter((r) => r.status === "VERIFIED").length} href="/service-reports?status=VERIFIED" />}
                {!officeView && <KpiCard label="Service Reports — Confirmed" value={data.filter((r) => r.status === "CONFIRMED").length} href="/service-reports?status=CONFIRMED" />}
              </>
            ))}

          {canReadQuotations &&
            section(quotations, (data) => (
              <>
                <KpiCard
                  label="Quotations — Pending Manager Approval"
                  value={data.filter((q) => q.status === "PENDING_APPROVAL").length}
                  href="/quotations?status=PENDING_APPROVAL"
                />
                <KpiCard
                  label="Quotations — Pending Owner Approval"
                  value={data.filter((q) => q.status === "PENDING_OWNER_APPROVAL").length}
                  href="/quotations?status=PENDING_OWNER_APPROVAL"
                />
                <KpiCard
                  label="Quotations — Sent"
                  value={data.filter((q) => q.status === "SENT").length}
                  href="/quotations?status=SENT"
                />
                <KpiCard label="Quotations — Accepted" value={data.filter((q) => q.status === "ACCEPTED").length} href="/quotations?status=ACCEPTED" />
              </>
            ))}

          {canReadWorkOrders && !technicianView &&
            section(workOrders, (data) => (
              <>
                <KpiCard
                  label="Work Orders — Scheduled"
                  value={data.filter((w) => w.status === "SCHEDULED").length}
                  href={`/work-orders?status=SCHEDULED${managerView ? "&scope=assigned" : ""}`}
                />
                {!officeView && <KpiCard
                  label="Work Orders — In Progress"
                  value={data.filter((w) => w.status === "IN_PROGRESS").length}
                  href={`/work-orders?status=IN_PROGRESS${managerView ? "&scope=assigned" : ""}`}
                />}
                {!officeView && <KpiCard
                  label="Work Orders — Cancellation Requested"
                  value={data.filter((w) => w.cancellationRequestedAt !== null && w.cancelledAt === null).length}
                  href={`/work-orders?status=SCHEDULED,IN_PROGRESS${managerView ? "&scope=assigned" : ""}`}
                />}
              </>
            ))}
        </div>
      )}

    </div>
  );
}
