"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  closeInquiry,
  getCustomer,
  getInquiry,
  listContactsForCustomer,
  listSitesForCustomer,
  type Contact,
  type Customer,
  type Inquiry,
  type Site,
} from "@/lib/api";
import { useReferenceData } from "@/lib/use-reference-data";
import { ApiError } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/format";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, LoadingState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EditInquiryDialog } from "@/components/inquiries/edit-inquiry-dialog";
import { ConvertToQuotationDialog } from "@/components/inquiries/convert-to-quotation-dialog";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm">{value}</p>
    </div>
  );
}

export default function InquiryDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user, accessToken, hasPermission } = useAuth();
  const { trades, inquirySources, inquiryTypes } = useReferenceData();

  const [inquiry, setInquiry] = useState<Inquiry | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setError(null);
    try {
      const inq = await getInquiry(accessToken, params.id);
      setInquiry(inq);
      const [cust, siteRows, contactRows] = await Promise.all([
        getCustomer(accessToken, inq.customerId),
        listSitesForCustomer(accessToken, inq.customerId),
        listContactsForCustomer(accessToken, inq.customerId),
      ]);
      setCustomer(cust);
      setSites(siteRows);
      setContacts(contactRows);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load inquiry.");
    }
  }, [accessToken, params.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!user) router.replace("/login");
  }, [user, router]);

  async function handleClose() {
    if (!accessToken || !inquiry) return;
    setClosing(true);
    try {
      setInquiry(await closeInquiry(accessToken, inquiry.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to close inquiry.");
    } finally {
      setClosing(false);
    }
  }

  if (!user) return null;

  if (error) {
    return (
      <main className="container py-8">
        <Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Inquiry" }]} />
        <ErrorState message={error} onRetry={load} />
      </main>
    );
  }

  if (!inquiry || !customer) {
    return (
      <main className="container py-8">
        <Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Inquiry" }]} />
        <LoadingState label="Loading inquiry…" />
      </main>
    );
  }

  const isOpen = inquiry.status === "OPEN";
  const site = sites.find((s) => s.id === inquiry.siteId);
  const contact = contacts.find((c) => c.id === inquiry.contactId);
  const source = inquirySources.find((s) => s.code === inquiry.sourceCode);
  const trade = trades.find((t) => t.code === inquiry.tradeCode);
  const inquiryType = inquiryTypes.find((t) => t.code === inquiry.inquiryTypeCode);

  return (
    <main className="container py-8">
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Customers", href: "/customers" },
          { label: customer.name, href: `/customers/${customer.id}` },
          { label: inquiry.inquiryNumber },
        ]}
      />
      <PageHeader
        title={inquiry.inquiryNumber}
        description={inquiry.subject}
        actions={
          <>
            <StatusBadge status={inquiry.status} />
            {isOpen && hasPermission("inquiries", "update") && (
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                Edit
              </Button>
            )}
            {isOpen && hasPermission("inquiries", "close") && (
              <Button variant="outline" size="sm" onClick={handleClose} disabled={closing}>
                {closing ? "Closing…" : "Close Inquiry"}
              </Button>
            )}
            {isOpen && hasPermission("quotations", "create") && <ConvertToQuotationDialog inquiry={inquiry} sites={sites} />}
          </>
        }
      />

      <Card>
        <CardContent className="grid grid-cols-1 gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Site" value={site?.label ?? "—"} />
          <Field label="Contact" value={contact?.fullName ?? "—"} />
          <Field label="Source" value={source?.label ?? "—"} />
          <Field label="Trade" value={trade?.label ?? "—"} />
          <Field label="Inquiry type" value={inquiryType?.label ?? "—"} />
          <Field label="Customer reference no." value={inquiry.customerReferenceNo ?? "—"} />
          <Field label="Preferred service date" value={formatDate(inquiry.preferredServiceDate)} />
          <Field label="Created" value={formatDateTime(inquiry.createdAt)} />
          {inquiry.status === "CLOSED" && <Field label="Closed" value={formatDateTime(inquiry.closedAt)} />}
          {inquiry.status === "CONVERTED" && <Field label="Converted" value={formatDateTime(inquiry.convertedAt)} />}
          <div className="sm:col-span-2 lg:col-span-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Description</p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{inquiry.description || "—"}</p>
          </div>
        </CardContent>
      </Card>

      <EditInquiryDialog
        inquiry={inquiry}
        sites={sites}
        contacts={contacts}
        open={editOpen}
        onOpenChange={setEditOpen}
        onUpdated={setInquiry}
      />
    </main>
  );
}
