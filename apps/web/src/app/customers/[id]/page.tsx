"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import {
  getCustomer,
  listContactsForCustomer,
  listSitesForCustomer,
  updateCustomerStatus,
  type Contact,
  type Customer,
  type Site,
  CUSTOMER_TYPE_LABEL,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InquiriesTab } from "@/components/inquiries/inquiries-tab";
import { QuotationsTab } from "@/components/quotations/quotations-tab";
import { WorkOrdersTab } from "@/components/work-orders/work-orders-tab";
import { CustomerRecordDialog } from "@/components/customers/customer-record-dialog";
import { CustomerServiceReports } from "@/components/service-reports/customer-service-reports";

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user, accessToken, hasPermission } = useAuth();
  const canReadSites = hasPermission("sites", "read");
  const canReadContacts = hasPermission("contacts", "read");
  const canReadInquiries = hasPermission("inquiries", "read");
  const canReadQuotations = hasPermission("quotations", "read");
  const canReadWorkOrders = ["read", "read_assigned", "read_own"].some((action) => hasPermission("work_orders", action));
  const canReadReports = hasPermission("service_reports", "read");
  const defaultTab = canReadSites ? "sites" : canReadContacts ? "contacts" : canReadInquiries ? "inquiries" : canReadQuotations ? "quotations" : canReadWorkOrders ? "work-orders" : "service-reports";

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [sites, setSites] = useState<Site[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setError(null);
    try {
      const [customerRow, contactRows, siteRows] = await Promise.all([
        getCustomer(accessToken, params.id),
        canReadContacts ? listContactsForCustomer(accessToken, params.id) : Promise.resolve([]),
        canReadSites ? listSitesForCustomer(accessToken, params.id) : Promise.resolve([]),
      ]);
      setCustomer(customerRow);
      setContacts(contactRows);
      setSites(siteRows);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load customer.");
    }
  }, [accessToken, params.id, canReadContacts, canReadSites]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!user) router.replace("/login");
  }, [user, router]);

  async function toggleStatus() {
    if (!accessToken || !customer) return;
    setStatusUpdating(true);
    try {
      const next = customer.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
      const updated = await updateCustomerStatus(accessToken, customer.id, next);
      setCustomer(updated);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to update customer status.");
    } finally {
      setStatusUpdating(false);
    }
  }

  if (!user) return null;

  if (error) {
    return (
      <main className="container py-8">
        <Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Customers", href: "/customers" }, { label: "Customer" }]} />
        <ErrorState message={error} onRetry={load} />
      </main>
    );
  }

  if (!customer) {
    return (
      <main className="container py-8">
        <Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Customers", href: "/customers" }, { label: "Customer" }]} />
        <LoadingState label="Loading customer…" />
      </main>
    );
  }

  return (
    <main className="container py-8">
      <Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Customers", href: "/customers" }, { label: customer.name }]} />
      <PageHeader
        title={customer.name}
        description={CUSTOMER_TYPE_LABEL[customer.customerType]}
        actions={
          <>
            <StatusBadge status={customer.status} />
            {hasPermission("customers", "update") && <CustomerRecordDialog kind="customer" customer={customer} onSaved={load} />}
            {hasPermission("customers", "deactivate") && (
              <Button variant="outline" size="sm" onClick={toggleStatus} disabled={statusUpdating}>
                {customer.status === "ACTIVE" ? "Deactivate" : "Activate"}
              </Button>
            )}
          </>
        }
      />

      <Card className="mb-6">
        <CardContent className="grid grid-cols-1 gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Billing address</p>
            <p className="mt-1 text-sm">{customer.billingAddress}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Phone</p>
            <p className="mt-1 text-sm">{customer.phone ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</p>
            <p className="mt-1 text-sm">{customer.email ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tax ID</p>
            <p className="mt-1 text-sm">{customer.taxId ?? "—"}</p>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue={defaultTab}>
        <div className="max-w-full overflow-x-auto pb-1">
          <TabsList>
            {canReadSites && <TabsTrigger value="sites">Sites {sites ? `(${sites.length})` : ""}</TabsTrigger>}
            {canReadContacts && <TabsTrigger value="contacts">Contacts {contacts ? `(${contacts.length})` : ""}</TabsTrigger>}
            {canReadInquiries && <TabsTrigger value="inquiries">Inquiries</TabsTrigger>}
            {canReadQuotations && <TabsTrigger value="quotations">Quotations</TabsTrigger>}
            {canReadWorkOrders && <TabsTrigger value="work-orders">Work Orders</TabsTrigger>}
            {canReadReports && <TabsTrigger value="service-reports">Service Reports</TabsTrigger>}
          </TabsList>
        </div>

        {canReadSites && <TabsContent value="sites">
          {hasPermission("sites", "create") && <div className="mb-3"><CustomerRecordDialog kind="site" customer={customer} onSaved={load} /></div>}
          {sites === null && <LoadingState label="Loading sites…" />}
          {sites !== null && sites.length === 0 && (
            <EmptyState title="No sites yet" description="Sites are the serviceable locations for this customer." />
          )}
          {sites !== null && sites.length > 0 && (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Site</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sites.map((site) => (
                    <TableRow key={site.id}>
                      <TableCell className="font-medium"><Link className="text-primary hover:underline" href={`/sites/${site.id}`}>{site.label}</Link></TableCell>
                      <TableCell>{site.addressLine}</TableCell>
                      <TableCell>
                        <StatusBadge status={site.status} />
                      </TableCell>
                      <TableCell>
                        {hasPermission("sites", "update") && <CustomerRecordDialog kind="site" customer={customer} record={site} onSaved={load} />}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>}

        {canReadContacts && <TabsContent value="contacts">
          {hasPermission("contacts", "create") && <div className="mb-3"><CustomerRecordDialog kind="contact" customer={customer} onSaved={load} /></div>}
          {contacts === null && <LoadingState label="Loading contacts…" />}
          {contacts !== null && contacts.length === 0 && (
            <EmptyState title="No contacts yet" description="People at this customer who can be reached for site visits." />
          )}
          {contacts !== null && contacts.length > 0 && (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Designation</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contacts.map((contact) => (
                    <TableRow key={contact.id}>
                      <TableCell className="font-medium">
                        {contact.fullName}
                        {contact.isPrimary && <span className="ml-2 text-xs text-muted-foreground">(Primary)</span>}
                      </TableCell>
                      <TableCell>{contact.designation ?? "—"}</TableCell>
                      <TableCell>{contact.phone ?? "—"}</TableCell>
                      <TableCell>{contact.email ?? "—"}</TableCell>
                      <TableCell>
                        <StatusBadge status={contact.status} />
                      </TableCell>
                      <TableCell>{hasPermission("contacts", "update") && <CustomerRecordDialog kind="contact" customer={customer} record={contact} onSaved={load} />}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>}

        {canReadInquiries && <TabsContent value="inquiries">
          <InquiriesTab customerId={customer.id} sites={sites ?? []} contacts={contacts ?? []} />
        </TabsContent>}

        {canReadQuotations && <TabsContent value="quotations">
          <QuotationsTab customerId={customer.id} sites={sites ?? []} />
        </TabsContent>}

        {canReadWorkOrders && <TabsContent value="work-orders">
          <WorkOrdersTab customerId={customer.id} sites={sites ?? []} />
        </TabsContent>}
        {canReadReports && <TabsContent value="service-reports">
          <CustomerServiceReports customerId={customer.id} sites={sites ?? []} />
        </TabsContent>}
      </Tabs>
    </main>
  );
}
