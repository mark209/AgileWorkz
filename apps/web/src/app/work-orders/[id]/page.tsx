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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkOrderLifecycleActions } from "@/components/work-orders/work-order-lifecycle-actions";
import { WorkOrderAssignmentPanel } from "@/components/work-orders/work-order-assignment-panel";
import { WorkOrderServiceReportsPanel } from "@/components/work-orders/work-order-service-reports-panel";

function fmt(value: string | null): string {
  return value === null || value === "" ? "—" : value;
}

export default function WorkOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user, accessToken, hasPermission, isLoading: authLoading } = useAuth();

  const [workOrder, setWorkOrder] = useState<WorkOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canRead = hasPermission("work_orders", "read");

  const load = useCallback(async () => {
    if (!accessToken || !canRead) return;
    setError(null);
    try {
      setWorkOrder(await getWorkOrder(accessToken, params.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load work order.");
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
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-6">
      <Breadcrumbs items={[{ label: "Work Orders", href: "/work-orders" }, { label: workOrder?.workOrderNumber ?? "Work Order" }]} />

      {error && <ErrorState message={error} onRetry={load} />}
      {!workOrder && !error && <LoadingState label="Loading work order…" />}

      {workOrder && (
        <>
          <PageHeader
            title={workOrder.workOrderNumber}
            description={`${workOrder.customer.name} — ${workOrder.site.label}`}
            actions={<StatusBadge status={workOrder.status} />}
          />

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div>
                <span className="text-muted-foreground">Type:</span> {workOrder.workOrderType === "FROM_QUOTATION" ? "From Quotation" : "Standalone"}
              </div>
              <div>
                <span className="text-muted-foreground">Scheduled:</span> {workOrder.scheduledDate ? new Date(workOrder.scheduledDate).toLocaleDateString() : "—"}
              </div>
              {workOrder.standaloneReasonType && (
                <div>
                  <span className="text-muted-foreground">Reason:</span> {workOrder.standaloneReasonType}
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
                <span className="text-muted-foreground">Started:</span> {workOrder.startedAt ? new Date(workOrder.startedAt).toLocaleString() : "—"}
              </div>
              <div>
                <span className="text-muted-foreground">Completed:</span> {workOrder.completedAt ? new Date(workOrder.completedAt).toLocaleString() : "—"}
              </div>
              <div>
                <span className="text-muted-foreground">Closed:</span> {workOrder.closedAt ? new Date(workOrder.closedAt).toLocaleString() : "—"}
              </div>
              {workOrder.cancelledAt && (
                <div className="sm:col-span-2">
                  <span className="text-muted-foreground">Cancelled:</span> {new Date(workOrder.cancelledAt).toLocaleString()}
                  {workOrder.cancellationReason && <p className="mt-1">{fmt(workOrder.cancellationReason)}</p>}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <WorkOrderLifecycleActions workOrder={workOrder} onChanged={load} />
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
            <CardHeader>
              <CardTitle>Linked Service Reports</CardTitle>
            </CardHeader>
            <CardContent>
              <WorkOrderServiceReportsPanel workOrderId={workOrder.id} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
