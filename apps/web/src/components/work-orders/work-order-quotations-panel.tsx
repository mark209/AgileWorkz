"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { getSite, listRelatedQuotations, type Quotation, type Site, type WorkOrder } from "@/lib/api";
import { CreateQuotationDialog } from "@/components/quotations/create-quotation-dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { ErrorState, LoadingState } from "@/components/shared/states";

export function WorkOrderQuotationsPanel({ workOrder }: { workOrder: WorkOrder }) {
  const { accessToken, hasPermission } = useAuth();
  const [quotations, setQuotations] = useState<Quotation[] | null>(null);
  const [site, setSite] = useState<Site | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const load = useCallback(async () => {
    if (!accessToken) return;
    const request = ++requestId.current;
    setError(null);
    setQuotations(null);
    try {
      const [rows, serviceSite] = await Promise.all([
        listRelatedQuotations(accessToken, workOrder.id),
        hasPermission("quotations", "create") ? getSite(accessToken, workOrder.siteId) : Promise.resolve(null),
      ]);
      if (request === requestId.current) { setQuotations(rows); setSite(serviceSite); }
    } catch { if (request === requestId.current) setError("Could not load quotations and the service site. Please try again."); }
  }, [accessToken, workOrder.id, workOrder.siteId, hasPermission]);
  const invalidateRequest = useCallback(() => { requestId.current++; }, []);
  useEffect(() => { void load(); return invalidateRequest; }, [load, invalidateRequest]);
  return <div className="space-y-3">
    {site && hasPermission("quotations", "create") && <CreateQuotationDialog customerId={workOrder.customerId} sites={[site]} sourceWorkOrderId={workOrder.id} />}
    {error && <ErrorState message={error} onRetry={load} />}
    {!quotations && !error && <LoadingState label="Loading quotations…" />}
    {quotations?.length === 0 && <p className="text-sm text-muted-foreground">No related quotations yet.</p>}
    {quotations?.map((quotation) => <div key={quotation.id} className="space-y-2 text-sm"><div className="flex items-center justify-between gap-2">
      <Link href={`/quotations/${quotation.id}`} className="text-primary underline-offset-2 hover:underline">{quotation.quotationNumber}{quotation.sourceWorkOrderId ? " · Additional" : " · Original"}</Link>
      <StatusBadge status={quotation.status} />
    </div>
    {quotation.workOrders?.map((order) => <Link key={order.id} href={`/work-orders/${order.id}`} className="block pl-3 text-primary underline-offset-2 hover:underline">{order.workOrderNumber} · View Work Order and Service Reports</Link>)}
    </div>)}
  </div>;
}
