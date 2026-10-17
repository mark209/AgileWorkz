"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { listCustomers, type Customer, CUSTOMER_TYPE_LABEL } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { PageHeader } from "@/components/shared/page-header";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { CreateCustomerDialog } from "@/components/customers/create-customer-dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function CustomerListPage() {
  const router = useRouter();
  const { accessToken, hasPermission, user } = useAuth();
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    if (!accessToken) return;
    setError(null);
    try {
      const rows = await listCustomers(accessToken);
      setCustomers(rows);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load customers.");
    }
  }, [accessToken]);

  useEffect(() => {
    load();
  }, [load]);

  // Same "redirect to /login if the in-memory session is gone" guard as
  // dashboard/page.tsx (Phase 1) — needed on every authenticated page since
  // tokens are deliberately never persisted (see auth-context.tsx), so a
  // hard page load always clears them.
  useEffect(() => {
    if (!user) router.replace("/login");
  }, [user, router]);

  // The list endpoint has no search/filter query param (Steps 3-7 didn't add
  // one, and Step 8 isn't a reason to change the backend contract) — filtered
  // client-side over the already-fetched list instead.
  const filtered = useMemo(() => {
    if (!customers) return [];
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q),
    );
  }, [customers, search]);

  if (!user) return null;

  return (
    <main className="container py-8">
      <Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Customers" }]} />
      <PageHeader
        title="Customers"
        description="Every customer account and their billing relationship with AgileWorks."
        actions={hasPermission("customers", "create") ? <CreateCustomerDialog onCreated={load} /> : undefined}
      />

      <div className="mb-4 max-w-sm">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, or phone"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search customers"
          />
        </div>
      </div>

      {error && <ErrorState message={error} onRetry={load} />}
      {!error && customers === null && <LoadingState label="Loading customers…" />}
      {!error && customers !== null && customers.length === 0 && (
        <EmptyState
          title="No customers yet"
          description={
            hasPermission("customers", "create")
              ? 'Get started by creating the first customer with "New Customer" above.'
              : "No customer accounts have been created yet."
          }
        />
      )}
      {!error && customers !== null && customers.length > 0 && filtered.length === 0 && (
        <EmptyState title="No matching customers" description="Try a different search term." />
      )}
      {!error && filtered.length > 0 && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell className="font-medium"><Link className="text-primary hover:underline" href={`/customers/${customer.id}`}>{customer.name}</Link></TableCell>
                  <TableCell>{CUSTOMER_TYPE_LABEL[customer.customerType]}</TableCell>
                  <TableCell>{customer.phone ?? "—"}</TableCell>
                  <TableCell>{customer.email ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={customer.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </main>
  );
}
