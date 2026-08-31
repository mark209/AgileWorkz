"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  listQuotationRevisions,
  listQuotationsForCustomer,
  QUOTATION_TYPE_LABEL,
  type Quotation,
  type QuotationRevision,
  type Site,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CreateQuotationDialog } from "./create-quotation-dialog";

export function QuotationsTab({ customerId, sites }: { customerId: string; sites: Site[] }) {
  const router = useRouter();
  const { accessToken, hasPermission } = useAuth();
  const [quotations, setQuotations] = useState<Quotation[] | null>(null);
  // Keyed by quotationId — the current revision's totals, fetched
  // separately since the list endpoint returns quotation headers only.
  const [currentRevisions, setCurrentRevisions] = useState<Record<string, QuotationRevision>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setError(null);
    try {
      const rows = await listQuotationsForCustomer(accessToken, customerId);
      setQuotations(rows);
      const entries = await Promise.all(
        rows.map(async (q) => {
          const revisions = await listQuotationRevisions(accessToken, q.id);
          const current = revisions.find((r) => r.isCurrent) ?? revisions[revisions.length - 1];
          return [q.id, current] as const;
        }),
      );
      setCurrentRevisions(Object.fromEntries(entries.filter(([, r]) => r)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load quotations.");
    }
  }, [accessToken, customerId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      {hasPermission("quotations", "create") && (
        <div className="mb-3 flex justify-end">
          <CreateQuotationDialog customerId={customerId} sites={sites} />
        </div>
      )}

      {error && <ErrorState message={error} onRetry={load} />}
      {!error && quotations === null && <LoadingState label="Loading quotations…" />}
      {!error && quotations !== null && quotations.length === 0 && (
        <EmptyState title="No quotations yet" description="Create one directly, or convert an inquiry from the Inquiries tab." />
      )}
      {!error && quotations !== null && quotations.length > 0 && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quotation #</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Revision</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {quotations.map((q) => {
                const revision = currentRevisions[q.id];
                return (
                  <TableRow key={q.id} className="cursor-pointer" onClick={() => router.push(`/quotations/${q.id}`)}>
                    <TableCell className="font-medium">{q.quotationNumber}</TableCell>
                    <TableCell>{QUOTATION_TYPE_LABEL[q.quotationType]}</TableCell>
                    <TableCell>{revision ? `Rev ${revision.revisionNumber}` : "—"}</TableCell>
                    <TableCell>
                      <StatusBadge status={q.status} />
                    </TableCell>
                    <TableCell>{revision ? formatMoney(revision.totalAmount) : "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
