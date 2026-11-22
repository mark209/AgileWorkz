"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { listWorkOrders, type WorkOrder } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { classifySchedule, filterSchedule, formatScheduleDay, scheduleCounts, scheduleDateKey, scheduleToday,
  SCHEDULE_CATEGORIES, SCHEDULE_LABELS, type ScheduleCategory, type ScheduleFilters } from "@/lib/work-schedule";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const categoryStyle: Record<ScheduleCategory | "finished", string> = {
  overdue: "border-destructive/40 bg-destructive/5 text-destructive",
  today: "border-amber-300 bg-amber-50 text-amber-900",
  upcoming: "border-primary/30 bg-accent text-primary",
  unscheduled: "border-border bg-muted/40 text-muted-foreground",
  finished: "border-border bg-muted/40 text-muted-foreground",
};
const statusOptions = ["DRAFT", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "CLOSED", "CANCELLED"] as const;

export default function WorkSchedulePage() {
  const { accessToken, hasPermission, isLoading: authLoading } = useAuth();
  const canRead = ["read", "read_assigned", "read_own"].some(action => hasPermission("work_orders", action));
  const [result, setResult] = useState<{ token: string; rows: WorkOrder[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [today, setToday] = useState(() => scheduleToday());
  const [filters, setFilters] = useState<ScheduleFilters>({});

  useEffect(() => {
    if (authLoading || !accessToken || !canRead) return;
    let alive = true;
    let pending = false;
    async function load() {
      if (pending) return;
      pending = true;
      setRefreshing(true);
      setError(null);
      setToday(scheduleToday());
      try {
        // The existing endpoint applies broad, responsible-Manager and active
        // technician scopes on the server. No new permission or schedule store.
        const rows = await listWorkOrders(accessToken!);
        if (alive) { setResult({ token: accessToken!, rows }); setError(null); setUpdatedAt(new Date()); }
      } catch (e) {
        if (alive) {
          setResult(null);
          setError(e instanceof ApiError && e.status === 403 ? "You do not have permission to view this work schedule." : "Could not load the work schedule. Please try again.");
        }
      } finally { pending = false; if (alive) setRefreshing(false); }
    }
    function refreshVisible() { if (document.visibilityState !== "hidden") void load(); }
    void load();
    const timer = window.setInterval(refreshVisible, 30_000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener("focus", refreshVisible); document.removeEventListener("visibilitychange", refreshVisible); };
  }, [accessToken, canRead, authLoading, refreshVersion]);

  const rows = result && result.token === accessToken ? result.rows : null;
  const options = useMemo(() => {
    const customers = new Map<string, string>();
    const technicians = new Map<string, string>();
    for (const order of rows ?? []) {
      customers.set(order.customerId, order.customer?.name ?? "Customer unavailable");
      for (const assignment of order.assignments) technicians.set(assignment.technicianId, assignment.technician.fullName);
    }
    const sorted = (values: Map<string, string>) => [...values].sort((a, b) => a[1].localeCompare(b[1]));
    return { customers: sorted(customers), technicians: sorted(technicians) };
  }, [rows]);
  const baseRows = useMemo(() => filterSchedule(rows ?? [], { ...filters, category: "all" }, today), [rows, filters, today]);
  const counts = scheduleCounts(baseRows, today);
  const visibleRows = filters.category && filters.category !== "all" ? baseRows.filter(order => classifySchedule(order, today) === filters.category) : baseRows;
  const groups = new Map<string, WorkOrder[]>();
  for (const order of visibleRows) {
    const key = scheduleDateKey(order.scheduledDate) ?? "unscheduled";
    const group = groups.get(key);
    if (group) group.push(order);
    else groups.set(key, [order]);
  }
  function updateFilter<K extends keyof ScheduleFilters>(key: K, value: ScheduleFilters[K]) { setFilters(current => ({ ...current, [key]: value })); }
  const invalidRange = Boolean(filters.from && filters.to && filters.from > filters.to);

  if (authLoading) return <LoadingState />;
  if (!canRead) return <div className="mx-auto max-w-3xl px-6 py-16"><ErrorState message="You do not have permission to view the work schedule." /></div>;

  return <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
    <PageHeader title="Work Schedule" description="Work Order dates and assigned teams in one timeline." actions={
      <Button variant="outline" onClick={() => setRefreshVersion(value => value + 1)} disabled={refreshing}><RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />{refreshing ? "Refreshing…" : "Refresh"}</Button>
    } />
    <p className="text-sm text-muted-foreground">The scheduled date is used for due-date categories. Dates follow Asia/Manila. Work Orders currently record a date only; separate due dates, times and multi-day ranges are not recorded.</p>
    <Card><CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
      <div className="space-y-1.5"><Label htmlFor="schedule-search">Search work schedule</Label><Input id="schedule-search" placeholder="Work Order, customer, job or technician" value={filters.search ?? ""} onChange={event => updateFilter("search", event.target.value)} /></div>
      <div className="space-y-1.5">
        <Label htmlFor="schedule-tech">Technician</Label>
        <Select id="schedule-tech" value={filters.technicianId ?? ""} onChange={event => updateFilter("technicianId", event.target.value)}>
          <option value="">All technicians / teams</option>
          {filters.technicianId && !options.technicians.some(([id]) => id === filters.technicianId) && <option value={filters.technicianId}>Selected technician (no current jobs)</option>}
          {options.technicians.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="schedule-customer">Customer</Label>
        <Select id="schedule-customer" value={filters.customerId ?? ""} onChange={event => updateFilter("customerId", event.target.value)}>
          <option value="">All customers</option>
          {filters.customerId && !options.customers.some(([id]) => id === filters.customerId) && <option value={filters.customerId}>Selected customer (no current jobs)</option>}
          {options.customers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </Select>
      </div>
      <div className="space-y-1.5"><Label htmlFor="schedule-status">Work Order status</Label><Select id="schedule-status" value={filters.status ?? "active"} onChange={event => { updateFilter("status", event.target.value as ScheduleFilters["status"]); updateFilter("category", "all"); }}><option value="active">Active work</option><option value="all">All statuses</option>{statusOptions.map(status => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</Select></div>
      <div className="space-y-1.5"><Label htmlFor="schedule-from">Scheduled from</Label><Input id="schedule-from" type="date" value={filters.from ?? ""} onChange={event => updateFilter("from", event.target.value)} /></div>
      <div className="space-y-1.5"><Label htmlFor="schedule-to">Scheduled through</Label><Input id="schedule-to" type="date" value={filters.to ?? ""} onChange={event => updateFilter("to", event.target.value)} /></div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-3"><Button variant="ghost" size="sm" onClick={() => setFilters({})}>Clear filters</Button><p className="text-xs text-muted-foreground">{filters.from || filters.to ? "Date ranges include both end dates and exclude unscheduled work." : "Completed, closed and cancelled jobs are excluded from active counts."}</p></div>
      {invalidRange && <p role="alert" className="text-sm text-destructive sm:col-span-2 lg:col-span-3">The end date must be on or after the start date.</p>}
    </CardContent></Card>

    {error && <ErrorState message={error} onRetry={() => setRefreshVersion(value => value + 1)} />}
    {!rows && !error && <LoadingState label="Loading work schedule…" />}
    {rows && !error && <>
      <div><h2 className="text-base font-semibold">Active work</h2><p className="text-xs text-muted-foreground">Counts follow the filters above. Select a card to narrow the timeline.</p></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Active schedule summary">
        {SCHEDULE_CATEGORIES.map(category => <button key={category} type="button" aria-label={`${SCHEDULE_LABELS[category]}: ${counts[category]}`} aria-pressed={filters.category === category} onClick={() => updateFilter("category", filters.category === category ? "all" : category)} className={`rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${categoryStyle[category]} ${filters.category === category ? "ring-2 ring-ring" : ""}`}><span className="block text-sm font-medium">{SCHEDULE_LABELS[category]}</span><span className="mt-1 block text-2xl font-semibold tabular-nums">{counts[category]}</span></button>)}
      </div>
      <section aria-labelledby="work-timeline-heading" className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="work-timeline-heading" className="text-lg font-semibold">Work Timeline</h2><p className="text-xs text-muted-foreground" role="status">{visibleRows.length} jobs · Refreshes every 30 seconds{updatedAt ? ` · Updated ${updatedAt.toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit" })}` : ""}</p></div>
        {filters.category && filters.category !== "all" && <Button variant="outline" size="sm" onClick={() => updateFilter("category", "all")}>Show all schedule categories</Button>}
        {rows.length === 0 ? <EmptyState title="No work orders yet" description="Work Orders within your access scope will appear here automatically." /> : visibleRows.length === 0 ? <EmptyState title="No matching work scheduled" description="Try another filter or clear filters to see your available Work Orders." /> : [...groups].map(([day, orders]) => <section key={day} aria-label={day === "unscheduled" ? "Unscheduled work" : formatScheduleDay(day)} className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{day === "unscheduled" ? "Unscheduled" : formatScheduleDay(day)}</h3>
          <ol className="space-y-3 border-l-2 border-border pl-3 sm:pl-5">{orders.map(order => {
            const category = classifySchedule(order, today);
            return <li key={order.id}><Card><CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><Link href={`/work-orders/${order.id}`} className="break-words font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{order.workOrderNumber}</Link><p className="mt-1 break-words text-sm font-medium">{order.customer?.name ?? "Customer unavailable"}</p><p className="text-sm text-muted-foreground">{order.site?.label ?? "Site unavailable"}</p></div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${categoryStyle[category]}`}>{SCHEDULE_LABELS[category]}</span><StatusBadge status={order.status} /></div></div>
              <p className="break-words text-sm">{order.description || order.standaloneReason || (order.workOrderType === "FROM_QUOTATION" ? "Service from quotation" : "Work Order")}</p>
              <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">Scheduled / due date</dt><dd>{day === "unscheduled" ? "No valid schedule recorded" : <><time dateTime={day}>{formatScheduleDay(day)}</time><span className="text-muted-foreground"> · Time not recorded</span></>}</dd></div><div><dt className="text-xs text-muted-foreground">Assigned technician / team</dt><dd className="break-words">{order.assignments.length ? order.assignments.map(assignment => assignment.technician.fullName).join(", ") : "No technician assigned"}</dd></div></dl>
            </CardContent></Card></li>;
          })}</ol>
        </section>)}
      </section>
    </>}
  </div>;
}
