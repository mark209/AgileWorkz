"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { listWorkOrdersForCustomer, type Site, type WorkOrder } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CreateWorkOrderDialog } from "./create-work-order-dialog";

/**
 * Phase 4 Operations Frontend — mirrors QuotationsTab's exact pattern
 * (same tab-of-a-customer-detail-page shape, same list/dialog/table
 * conventions). Reuses the customer-scoped GET /customers/:id/work-orders
 * endpoint that already existed since Step 3 — nothing new here beyond the
 * UI itself.
 */
export function WorkOrdersTab({ customerId, sites }: { customerId: string; sites: Site[] }) {
  const { accessToken, hasPermission } = useAuth();
  const [workOrders, setWorkOrders] = useState<WorkOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setError(null);
    try {
      setWorkOrders(await listWorkOrdersForCustomer(accessToken, customerId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load work orders.");
    }
  }, [accessToken, customerId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      {hasPermission("work_orders", "create") && (
        <div className="mb-3 flex justify-end">
          <CreateWorkOrderDialog customerId={customerId} sites={sites} onCreated={load} />
        </div>
      )}

      {error && <ErrorState message={error} onRetry={load} />}
      {!error && workOrders === null && <LoadingState label="Loading work orders…" />}
      {!error && workOrders !== null && workOrders.length === 0 && (
        <EmptyState title="No work orders yet" description="Create one directly, or convert an accepted quotation." />
      )}
      {!error && workOrders !== null && workOrders.length > 0 && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Work Order #</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Scheduled</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workOrders.map((wo) => (
                <TableRow key={wo.id}>
                  <TableCell className="font-medium"><Link className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/work-orders/${wo.id}`}>{wo.workOrderNumber}</Link></TableCell>
                  <TableCell>{wo.site.label}</TableCell>
                  <TableCell>{wo.workOrderType === "FROM_QUOTATION" ? "From Quotation" : "Standalone"}</TableCell>
                  <TableCell>{wo.scheduledDate ? new Date(wo.scheduledDate).toLocaleDateString() : "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={wo.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
