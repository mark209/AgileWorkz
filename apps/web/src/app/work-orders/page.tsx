"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { listWorkOrders, type WorkOrder } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate } from "@/lib/format";
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
  const createdOutsideScope = searchParams.get("created") === "outside-scope";

  const [workOrders, setWorkOrders] = useState<WorkOrder[] | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const requestId = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const canRead = hasPermission("work_orders", "read") || hasPermission("work_orders", "read_assigned") || hasPermission("work_orders", "read_own");
  const assignedScope = assignedOnly || !hasPermission("work_orders", "read");
  const listKey = `${assignedOnly ? "assigned" : "all"}:${status ?? ""}`;

  const load = useCallback(async () => {
    if (!accessToken || !canRead) return;
    const request = ++requestId.current;
    setError(null);
    setWorkOrders(null);
    try {
      const rows = await (assignedOnly ? listWorkOrders(accessToken, status, true) : listWorkOrders(accessToken, status));
      if (request === requestId.current) { setWorkOrders(rows); setLoadedKey(listKey); }
    } catch (e) {
      if (request === requestId.current) setError(e instanceof ApiError && e.status === 403 ? "Access denied to these Work Orders." : e instanceof ApiError ? e.message : "Failed to load work orders.");
    }
  }, [accessToken, canRead, status, assignedOnly, listKey]);

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
  const currentWorkOrders = loadedKey === listKey ? workOrders : null;
  const visibleWorkOrders = currentWorkOrders?.filter((wo) =>
    wo.workOrderNumber.toLowerCase().includes(query) ||
    wo.customer.name.toLowerCase().includes(query) ||
    wo.site.label.toLowerCase().includes(query),
  ) ?? [];

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <PageHeader
        title="Work Orders"
        description={assignedScope ? `Work Orders assigned to you${status ? ` · Status: ${status.replaceAll(",", ", ")}` : ""}.` : status ? `Filtered by status: ${status.replaceAll(",", ", ")}` : "All work orders."}
      />

      {createdOutsideScope && <p role="status" className="mb-4 rounded-md border border-primary/30 bg-accent px-4 py-3 text-sm">Work Order created. It is not assigned to you, so it will not appear in this list. Super Admin can assign it to you if needed.</p>}

      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input aria-label="Search work orders" placeholder="Search work order, customer, or site" className="pl-8" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>

      {error && <ErrorState message={error} onRetry={load} />}
      {!currentWorkOrders && !error && <LoadingState label="Loading work orders…" />}
      {currentWorkOrders && currentWorkOrders.length === 0 && (
        <div className="space-y-3">
          <EmptyState title={assignedScope && status ? "No assigned Work Orders with this status" : assignedScope ? "No assigned Work Orders" : "No work orders found"} description={assignedScope && status ? "No assigned Work Orders match the current status filter." : assignedScope ? "Work Orders assigned to you will appear here." : "No work orders match the current filter."} />
          {status && <Link href={assignedOnly ? "/work-orders?scope=assigned" : "/work-orders"} className="inline-block text-sm font-medium text-primary underline underline-offset-2">Clear status filter</Link>}
        </div>
      )}
      {currentWorkOrders && currentWorkOrders.length > 0 && visibleWorkOrders.length === 0 && (
        <EmptyState title="No matching work orders" description="Try a different search term." />
      )}

      {visibleWorkOrders.length > 0 && (
        <>
        <div className="space-y-3 lg:hidden">
          {visibleWorkOrders.map((wo) => (
            <Card key={wo.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Link href={`/work-orders/${wo.id}`} className="font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{wo.workOrderNumber}</Link>
                  <StatusBadge status={wo.status} />
                </div>
                <div className="text-sm">
                  <p className="font-medium">{wo.customer.name}</p>
                  <p className="text-muted-foreground">{wo.site.label}</p>
                </div>
                <dl className="grid gap-1 text-sm text-muted-foreground">
                  <div><dt className="inline">Scheduled: </dt><dd className="inline text-foreground">{formatDate(wo.scheduledDate)}</dd></div>
                  <div><dt className="inline">Responsible Manager: </dt><dd className="inline text-foreground">{wo.responsibleManager?.fullName ?? "Unassigned"}</dd></div>
                  <div><dt className="inline">Technician(s): </dt><dd className="inline text-foreground">{wo.assignments.length > 0 ? wo.assignments.map((a) => a.technician.fullName).join(", ") : "Unassigned"}</dd></div>
                </dl>
                <Link href={`/work-orders/${wo.id}`} className="inline-flex min-h-10 items-center font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">View Work Order →</Link>
              </CardContent>
            </Card>
          ))}
        </div>
        <Card className="hidden lg:block">
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
                  <TableHead>Responsible Manager</TableHead>
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
                    <TableCell>{formatDate(wo.scheduledDate)}</TableCell>
                    <TableCell>
                      <StatusBadge status={wo.status} />
                    </TableCell>
                    <TableCell>{wo.responsibleManager?.fullName ?? "Unassigned"}</TableCell>
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
        </>
      )}
    </div>
  );
}
