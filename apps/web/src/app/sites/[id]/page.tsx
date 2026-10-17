"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { MapPin } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { getCustomer, getSite, listAssetsForSite, listEquipmentSystemsForSite, type Asset, type Customer, type EquipmentSystem, type Site } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DocumentPanel } from "@/components/documents/document-panel";

export default function SiteDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user, accessToken } = useAuth();

  const [site, setSite] = useState<Site | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [equipmentSystems, setEquipmentSystems] = useState<EquipmentSystem[] | null>(null);
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setError(null);
    try {
      const siteRow = await getSite(accessToken, params.id);
      setSite(siteRow);
      const [customerRow, systemRows, assetRows] = await Promise.all([
        getCustomer(accessToken, siteRow.customerId),
        listEquipmentSystemsForSite(accessToken, params.id),
        listAssetsForSite(accessToken, params.id),
      ]);
      setCustomer(customerRow);
      setEquipmentSystems(systemRows);
      setAssets(assetRows);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load site.");
    }
  }, [accessToken, params.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!user) router.replace("/login");
  }, [user, router]);

  if (!user) return null;

  if (error) {
    return (
      <main className="container py-8">
        <Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Customers", href: "/customers" }, { label: "Site" }]} />
        <ErrorState message={error} onRetry={load} />
      </main>
    );
  }

  if (!site) {
    return (
      <main className="container py-8">
        <Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Customers", href: "/customers" }, { label: "Site" }]} />
        <LoadingState label="Loading site…" />
      </main>
    );
  }

  const equipmentSystemNameById = new Map((equipmentSystems ?? []).map((s) => [s.id, s.name]));

  return (
    <main className="container py-8">
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Customers", href: "/customers" },
          { label: customer?.name ?? "Customer", href: customer ? `/customers/${customer.id}` : undefined },
          { label: site.label },
        ]}
      />
      <PageHeader title={site.label} description={customer ? `Site of ${customer.name}` : undefined} actions={<StatusBadge status={site.status} />} />

      <Card className="mb-6">
        <CardContent className="grid grid-cols-1 gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Address</p>
            <p className="mt-1 text-sm">
              {site.addressLine}
              {site.city ? `, ${site.city}` : ""}
              {site.region ? `, ${site.region}` : ""}
              {site.postalCode ? ` ${site.postalCode}` : ""}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Customer</p>
            <p className="mt-1 text-sm">
              {customer ? (
                <a href={`/customers/${customer.id}`} className="text-primary hover:underline">
                  {customer.name}
                </a>
              ) : (
                "—"
              )}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Access notes</p>
            <p className="mt-1 text-sm">{site.accessNotes ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Map</p>
            {site.geoLat && site.geoLng ? (
              // A plain link to an external map, not an embedded map widget —
              // showing a real pin would mean adding a map provider/API key,
              // which is out of scope for this V1 screen.
              <a
                href={`https://www.google.com/maps?q=${site.geoLat},${site.geoLng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                View on map
              </a>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">No coordinates recorded</p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Equipment systems</CardTitle>
          </CardHeader>
          <CardContent>
            {equipmentSystems === null && <LoadingState label="Loading equipment systems…" />}
            {equipmentSystems !== null && equipmentSystems.length === 0 && (
              <EmptyState title="No equipment systems" description="Logical groupings like a VRF system or a chilled-water plant appear here." />
            )}
            {equipmentSystems !== null && equipmentSystems.length > 0 && (
              <ul className="divide-y">
                {equipmentSystems.map((system) => (
                  <li key={system.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-medium">{system.name}</span>
                    <StatusBadge status={system.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Equipment</CardTitle>
          </CardHeader>
          <CardContent>
            {assets === null && <LoadingState label="Loading equipment…" />}
            {assets !== null && assets.length === 0 && (
              <EmptyState title="No equipment registered" description="HVAC/electrical assets at this site appear here." />
            )}
            {assets !== null && assets.length > 0 && (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tag</TableHead>
                      <TableHead>System</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assets.map((asset) => (
                      <TableRow key={asset.id}>
                        <TableCell className="font-medium"><Link className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/assets/${asset.id}`}>{asset.assetTag}</Link></TableCell>
                        <TableCell>
                          {asset.equipmentSystemId ? (equipmentSystemNameById.get(asset.equipmentSystemId) ?? "—") : "—"}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={asset.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Documents</CardTitle>
        </CardHeader>
        <CardContent>
          <DocumentPanel relatedType="SITE" relatedId={site.id} />
        </CardContent>
      </Card>
    </main>
  );
}
