"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { listInquiriesForCustomer, type Contact, type Inquiry, type Site } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CreateInquiryDialog } from "./create-inquiry-dialog";

export function InquiriesTab({ customerId, sites, contacts }: { customerId: string; sites: Site[]; contacts: Contact[] }) {
  const { accessToken, hasPermission } = useAuth();
  const [inquiries, setInquiries] = useState<Inquiry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    if (!accessToken) return;
    setError(null);
    try {
      setInquiries(await listInquiriesForCustomer(accessToken, customerId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load inquiries.");
    }
  }, [accessToken, customerId]);

  useEffect(() => {
    load();
  }, [load]);

  const query = search.trim().toLowerCase();
  const visibleInquiries = inquiries?.filter((inquiry) =>
    inquiry.inquiryNumber.toLowerCase().includes(query) ||
    inquiry.subject.toLowerCase().includes(query),
  ) ?? [];

  return (
    <div>
      {hasPermission("inquiries", "create") && (
        <div className="mb-3 flex justify-end">
          <CreateInquiryDialog
            customerId={customerId}
            sites={sites}
            contacts={contacts}
            onCreated={(inquiry) => setInquiries((prev) => (prev ? [inquiry, ...prev] : [inquiry]))}
          />
        </div>
      )}

      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input aria-label="Search inquiries" placeholder="Search inquiry number or subject" className="pl-8" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>

      {error && <ErrorState message={error} onRetry={load} />}
      {!error && inquiries === null && <LoadingState label="Loading inquiries…" />}
      {!error && inquiries !== null && inquiries.length === 0 && (
        <EmptyState title="No inquiries yet" description="Customer requests logged here can be converted into a quotation." />
      )}
      {!error && inquiries !== null && inquiries.length > 0 && visibleInquiries.length === 0 && (
        <EmptyState title="No matching inquiries" description="Try a different search term." />
      )}
      {!error && visibleInquiries.length > 0 && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Inquiry #</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleInquiries.map((inquiry) => (
                <TableRow key={inquiry.id}>
                  <TableCell className="font-medium"><Link className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/inquiries/${inquiry.id}`}>{inquiry.inquiryNumber}</Link></TableCell>
                  <TableCell>{inquiry.subject}</TableCell>
                  <TableCell>
                    <StatusBadge status={inquiry.status} />
                  </TableCell>
                  <TableCell>{formatDate(inquiry.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
