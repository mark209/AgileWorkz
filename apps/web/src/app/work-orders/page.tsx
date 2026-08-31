"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { listWorkOrders, type WorkOrder } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/**
 * Phase 4 Operations Frontend — the staff Work Order list (approved
 * Decision 5): enough for daily dispatch at a glance — WO #, customer,
 * site, type, scheduled date, status, assigned technician(s) — all from
 * ONE call to the already-enriched GET /work-orders (no per-row follow-up
 * fetch for any of it). useSearchParams() needs a Suspense boundary — same
 * fix already applied to /quotations.
 */
export default function WorkOrdersListPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <WorkOrdersListPageContent />
    </Suspense>
  );
}

function WorkOrdersListPageContent() {
  const { accessToken, hasPermission, isLoading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const status = searchParams.get("status") ?? undefined;

  const [workOrders, setWorkOrders] = useState<WorkOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canRead = hasPermission("work_orders", "read");

  const load = useCallback(async () => {
    if (!accessToken || !canRead) return;
    setError(null);
    setWorkOrders(null);
    try {
      setWorkOrders(await listWorkOrders(accessToken, status));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load work orders.");
    }
  }, [accessToken, canRead, status]);

  useEffect(() => {
    load();
  }, [load]);

  if (authLoading) return <LoadingState />;
  if (!canRead) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <ErrorState message="You do not have permission to view Work Orders." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <PageHeader
        title="Work Orders"
        description={status ? `Filtered by status: ${status.replaceAll(",", ", ")}` : "All work orders."}
      />

      {error && <ErrorState message={error} onRetry={load} />}
      {!workOrders && !error && <LoadingState label="Loading work orders…" />}
      {workOrders && workOrders.length === 0 && (
        <EmptyState title="No work orders found" description="No work orders match the current filter." />
      )}

      {workOrders && workOrders.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Work Order #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Technician(s)</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {workOrders.map((wo) => (
                  <TableRow key={wo.id}>
                    <TableCell className="font-medium">{wo.workOrderNumber}</TableCell>
                    <TableCell>{wo.customer.name}</TableCell>
                    <TableCell>{wo.site.label}</TableCell>
                    <TableCell>{wo.workOrderType === "FROM_QUOTATION" ? "From Quotation" : "Standalone"}</TableCell>
                    <TableCell>{wo.scheduledDate ? new Date(wo.scheduledDate).toLocaleDateString() : "—"}</TableCell>
                    <TableCell>
                      <StatusBadge status={wo.status} />
                    </TableCell>
                    <TableCell>
                      {wo.assignments.length > 0 ? wo.assignments.map((a) => a.technician.fullName).join(", ") : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/work-orders/${wo.id}`} className="text-sm font-medium text-primary hover:underline">
                        View →
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
