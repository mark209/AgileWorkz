"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { listInquiriesForCustomer, type Contact, type Inquiry, type Site } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CreateInquiryDialog } from "./create-inquiry-dialog";

export function InquiriesTab({ customerId, sites, contacts }: { customerId: string; sites: Site[]; contacts: Contact[] }) {
  const router = useRouter();
  const { accessToken, hasPermission } = useAuth();
  const [inquiries, setInquiries] = useState<Inquiry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

      {error && <ErrorState message={error} onRetry={load} />}
      {!error && inquiries === null && <LoadingState label="Loading inquiries…" />}
      {!error && inquiries !== null && inquiries.length === 0 && (
        <EmptyState title="No inquiries yet" description="Customer requests logged here can be converted into a quotation." />
      )}
      {!error && inquiries !== null && inquiries.length > 0 && (
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
              {inquiries.map((inquiry) => (
                <TableRow key={inquiry.id} className="cursor-pointer" onClick={() => router.push(`/inquiries/${inquiry.id}`)}>
                  <TableCell className="font-medium">{inquiry.inquiryNumber}</TableCell>
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
