"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { RecentActivityList } from "@/components/dashboard/recent-activity-list";

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
  const { user, accessToken, hasPermission, isLoading: authLoading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  const canReadCustomers = hasPermission("customers", "read");
  const canReadServiceReports = hasPermission("service_reports", "read");
  const canReadQuotations = hasPermission("quotations", "read");
  // Deliberately the unscoped permission only — Technician's read_own does
  // NOT unlock this section (approved: "do not broaden Technician
  // permissions merely to make the Dashboard look fuller"; their own jobs
  // remain reachable only via GET /work-orders/mine, which has no frontend
  // page to show them on yet).
  const canReadWorkOrders = hasPermission("work_orders", "read");
  const canReadAudit = hasPermission("audit_logs", "read");

  const [customers, setCustomers] = useState<SectionState<Customer[]>>(initialSection);
  const [serviceReports, setServiceReports] = useState<SectionState<ServiceReportListItem[]>>(initialSection);
  const [quotations, setQuotations] = useState<SectionState<Quotation[]>>(initialSection);
  const [workOrders, setWorkOrders] = useState<SectionState<WorkOrder[]>>(initialSection);
  const [auditLogs, setAuditLogs] = useState<SectionState<AuditLogEntry[]>>(initialSection);

  const load = useCallback(async () => {
    if (!accessToken) return;

    if (canReadCustomers) {
      setCustomers(initialSection);
      try {
        setCustomers({ data: await listCustomers(accessToken), error: null });
      } catch (e) {
        setCustomers({ data: null, error: e instanceof ApiError ? e.message : "Failed to load customers." });
      }
    }

    if (canReadServiceReports) {
      setServiceReports(initialSection);
      try {
        setServiceReports({ data: await listServiceReports(accessToken, "PENDING_VERIFICATION,VERIFIED,CONFIRMED"), error: null });
      } catch (e) {
        setServiceReports({ data: null, error: e instanceof ApiError ? e.message : "Failed to load service reports." });
      }
    }

    if (canReadQuotations) {
      setQuotations(initialSection);
      try {
        setQuotations({ data: await listQuotations(accessToken, "PENDING_APPROVAL,SENT"), error: null });
      } catch (e) {
        setQuotations({ data: null, error: e instanceof ApiError ? e.message : "Failed to load quotations." });
      }
    }

    if (canReadWorkOrders) {
      setWorkOrders(initialSection);
      try {
        setWorkOrders({ data: await listWorkOrders(accessToken, "SCHEDULED,IN_PROGRESS"), error: null });
      } catch (e) {
        setWorkOrders({ data: null, error: e instanceof ApiError ? e.message : "Failed to load work orders." });
      }
    }

    if (canReadAudit) {
      setAuditLogs(initialSection);
      try {
        setAuditLogs({ data: await listAuditLogs(accessToken, 10), error: null });
      } catch (e) {
        setAuditLogs({ data: null, error: e instanceof ApiError ? e.message : "Failed to load recent activity." });
      }
    }
  }, [accessToken, canReadCustomers, canReadServiceReports, canReadQuotations, canReadWorkOrders, canReadAudit]);

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

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6">
      <PageHeader
        title={`Welcome, ${user.fullName}`}
        description={user.roles.join(", ") || "No roles assigned"}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await logout();
              router.push("/login");
            }}
          >
            Sign out
          </Button>
        }
      />

      {!hasAnySection && (
        <p className="text-sm text-muted-foreground">
          Your account has no operational Dashboard sections to display for your current role.
        </p>
      )}

      {(canReadCustomers || canReadServiceReports || canReadQuotations || canReadWorkOrders) && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
                  href="/work-orders?status=SCHEDULED"
                />
                <KpiCard
                  label="Work Orders — In Progress"
                  value={data.filter((w) => w.status === "IN_PROGRESS").length}
                  href="/work-orders?status=IN_PROGRESS"
                />
                <KpiCard
                  label="Work Orders — Cancellation Requested"
                  value={data.filter((w) => w.cancellationRequestedAt !== null && w.cancelledAt === null).length}
                  href="/work-orders?status=SCHEDULED,IN_PROGRESS"
                />
              </>
            ))}
        </div>
      )}

      {canReadAudit && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
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
  );
}
