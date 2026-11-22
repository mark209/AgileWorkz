"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { getWorkOrder, type WorkOrder } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, LoadingState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate, formatDateTime } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkOrderLifecycleActions } from "@/components/work-orders/work-order-lifecycle-actions";
import { WorkOrderAssignmentPanel } from "@/components/work-orders/work-order-assignment-panel";
import { WorkOrderServiceReportsPanel } from "@/components/work-orders/work-order-service-reports-panel";
import { ResponsibleManagerPanel } from "@/components/work-orders/responsible-manager-panel";
import { TechnicianWorkOrderActions } from "@/components/work-orders/technician-work-order-actions";
import { WorkOrderQuotationsPanel } from "@/components/work-orders/work-order-quotations-panel";

function fmt(value: string | null): string {
  return value === null || value === "" ? "—" : value;
}

export default function WorkOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user, accessToken, hasPermission, isLoading: authLoading } = useAuth();

  const [workOrder, setWorkOrder] = useState<WorkOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canRead = hasPermission("work_orders", "read") || hasPermission("work_orders", "read_assigned") || hasPermission("work_orders", "read_own");
  const canManageWorkOrder = ["update", "complete", "close", "request_cancel", "cancel"].some((action) => hasPermission("work_orders", action));
  const canReadFullReports = hasPermission("service_reports", "read") || hasPermission("service_reports", "read_assigned");

  const load = useCallback(async () => {
    if (!accessToken || !canRead) return;
    setError(null);
    setWorkOrder(null);
    try {
      setWorkOrder(await getWorkOrder(accessToken, params.id));
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? "Access denied: this Work Order is not assigned to you." : e instanceof ApiError ? e.message : "Failed to load work order.");
    }
  }, [accessToken, canRead, params.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  if (authLoading) return <LoadingState />;
  if (!canRead) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <ErrorState message="You do not have permission to view Work Orders." />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <Breadcrumbs items={[{ label: "Work Orders", href: "/work-orders" }, { label: workOrder?.workOrderNumber ?? "Work Order" }]} />

      {error && <ErrorState message={error} onRetry={load} />}
      {!workOrder && !error && <LoadingState label="Loading work order…" />}

      {workOrder && (
        <>
          <PageHeader className="mb-0"
            title={workOrder.workOrderNumber}
            description={`${workOrder.customer.name} — ${workOrder.site.label}`}
            actions={<StatusBadge status={workOrder.status} />}
          />

          {hasPermission("work_orders", "read_own") && workOrder.assignments.some((assignment) => assignment.technicianId === user?.id) &&
            <TechnicianWorkOrderActions workOrder={workOrder} onChanged={load} />}

          {canManageWorkOrder && <Card>
            <CardHeader>
              <CardTitle>Available actions</CardTitle>
            </CardHeader>
            <CardContent>
              <WorkOrderLifecycleActions workOrder={workOrder} onChanged={load} />
            </CardContent>
          </Card>}

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div>
                <span className="text-muted-foreground">Type:</span> {workOrder.workOrderType === "FROM_QUOTATION" ? "From Quotation" : "Standalone"}
              </div>
              <div>
                <span className="text-muted-foreground">Scheduled:</span> {formatDate(workOrder.scheduledDate)}
              </div>
              {workOrder.standaloneReasonType && (
                <div>
                  <span className="text-muted-foreground">Reason:</span> {workOrder.standaloneReasonType.charAt(0) + workOrder.standaloneReasonType.slice(1).toLowerCase()}
                </div>
              )}
              {workOrder.estimatedValue && (
                <div>
                  <span className="text-muted-foreground">Estimated value:</span> {workOrder.estimatedValue}
                </div>
              )}
              {workOrder.description && (
                <div className="sm:col-span-2">
                  <span className="text-muted-foreground">Description:</span>
                  <p className="mt-1 whitespace-pre-wrap">{workOrder.description}</p>
                </div>
              )}
              {workOrder.standaloneReason && (
                <div className="sm:col-span-2">
                  <span className="text-muted-foreground">Reason details:</span>
                  <p className="mt-1 whitespace-pre-wrap">{workOrder.standaloneReason}</p>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">Started:</span> {formatDateTime(workOrder.startedAt)}
              </div>
              <div>
                <span className="text-muted-foreground">Completed:</span> {formatDateTime(workOrder.completedAt)}
              </div>
              <div>
                <span className="text-muted-foreground">Closed:</span> {formatDateTime(workOrder.closedAt)}
              </div>
              {workOrder.cancelledAt && (
                <div className="sm:col-span-2">
                  <span className="text-muted-foreground">Cancelled:</span> {formatDateTime(workOrder.cancelledAt)}
                  {workOrder.cancellationReason && <p className="mt-1">{fmt(workOrder.cancellationReason)}</p>}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Technician Assignment</CardTitle>
            </CardHeader>
            <CardContent>
              <WorkOrderAssignmentPanel workOrder={workOrder} onChanged={load} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Responsible Manager</CardTitle></CardHeader>
            <CardContent><ResponsibleManagerPanel workOrder={workOrder} onChanged={load} /></CardContent>
          </Card>

          {(workOrder.tasks?.length ?? 0) > 0 && <Card>
            <CardHeader><CardTitle>Scope &amp; work instructions</CardTitle></CardHeader>
            <CardContent><ol className="list-decimal space-y-4 pl-5">{workOrder.tasks?.map((task) => <li key={task.id} className="text-sm">
              <p className="whitespace-pre-wrap font-medium">{task.description}</p>
              {task.method && <p className="mt-1 whitespace-pre-wrap">{task.method}</p>}
              {task.indications && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">Indications: {task.indications}</p>}
            </li>)}</ol></CardContent>
          </Card>}

          {hasPermission("quotations", "read") && <Card>
            <CardHeader><CardTitle>Related Quotations</CardTitle></CardHeader>
            <CardContent><WorkOrderQuotationsPanel workOrder={workOrder} /></CardContent>
          </Card>}

          {canReadFullReports && <Card>
            <CardHeader>
              <CardTitle>Linked Service Reports</CardTitle>
            </CardHeader>
            <CardContent>
              <WorkOrderServiceReportsPanel workOrderId={workOrder.id} />
            </CardContent>
          </Card>}
        </>
      )}
    </div>
  );
}
