"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { listWorkOrders, type WorkOrder } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  const assignedOnly = searchParams.get("scope") === "assigned";

  const [workOrders, setWorkOrders] = useState<WorkOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const canRead = hasPermission("work_orders", "read") || hasPermission("work_orders", "read_assigned") || hasPermission("work_orders", "read_own");
  const assignedScope = assignedOnly || !hasPermission("work_orders", "read");

  const load = useCallback(async () => {
    if (!accessToken || !canRead) return;
    setError(null);
    setWorkOrders(null);
    try {
        setWorkOrders(await (assignedOnly ? listWorkOrders(accessToken, status, true) : listWorkOrders(accessToken, status)));
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? "Access denied to these Work Orders." : e instanceof ApiError ? e.message : "Failed to load work orders.");
    }
  }, [accessToken, canRead, status, assignedOnly]);

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

  const query = search.trim().toLowerCase();
  const visibleWorkOrders = workOrders?.filter((wo) =>
    wo.workOrderNumber.toLowerCase().includes(query) ||
    wo.customer.name.toLowerCase().includes(query) ||
    wo.site.label.toLowerCase().includes(query),
  ) ?? [];

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <PageHeader
        title="Work Orders"
        description={assignedScope ? "Work Orders assigned to you." : status ? `Filtered by status: ${status.replaceAll(",", ", ")}` : "All work orders."}
      />

      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input aria-label="Search work orders" placeholder="Search work order, customer, or site" className="pl-8" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>

      {error && <ErrorState message={error} onRetry={load} />}
      {!workOrders && !error && <LoadingState label="Loading work orders…" />}
      {workOrders && workOrders.length === 0 && (
        <div className="space-y-3">
          <EmptyState title={assignedScope ? "No assigned services" : "No work orders found"} description={assignedScope ? "Work Orders assigned to you will appear here." : "No work orders match the current filter."} />
          {status && <Link href="/work-orders" className="inline-block text-sm font-medium text-primary underline underline-offset-2">Clear status filter</Link>}
        </div>
      )}
      {workOrders && workOrders.length > 0 && visibleWorkOrders.length === 0 && (
        <EmptyState title="No matching work orders" description="Try a different search term." />
      )}

      {visibleWorkOrders.length > 0 && (
        <Card>
          <CardContent className="overflow-x-auto pt-6">
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
                {visibleWorkOrders.map((wo) => (
                  <TableRow key={wo.id}>
                    <TableCell className="font-medium"><Link href={`/work-orders/${wo.id}`} className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{wo.workOrderNumber}</Link></TableCell>
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
