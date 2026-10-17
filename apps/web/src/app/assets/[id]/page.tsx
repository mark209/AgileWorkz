"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import {
  getAsset,
  getCustomer,
  getEquipmentSystem,
  getSite,
  listCapacityUnits,
  listEquipmentTypes,
  listServiceHistoryForAsset,
  type Asset,
  type CapacityUnit,
  type Customer,
  type EquipmentSystem,
  type EquipmentType,
  type Site,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, LoadingState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocumentPanel } from "@/components/documents/document-panel";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm">{value ?? "—"}</p>
    </div>
  );
}

export default function AssetDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user, accessToken, hasPermission } = useAuth();

  const [asset, setAsset] = useState<Asset | null>(null);
  const [site, setSite] = useState<Site | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [equipmentSystem, setEquipmentSystem] = useState<EquipmentSystem | null>(null);
  const [parentAsset, setParentAsset] = useState<Asset | null>(null);
  const [equipmentTypeLabel, setEquipmentTypeLabel] = useState<string | null>(null);
  const [capacityUnitLabel, setCapacityUnitLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ id: string; serviceReportNumber: string; status: string; serviceDate: string | null; uploadedAt: string }>>([]);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setError(null);
    try {
      const assetRow = await getAsset(accessToken, params.id);
      setAsset(assetRow);
      if (hasPermission("service_reports", "read")) {
        setHistory(await listServiceHistoryForAsset(accessToken, assetRow.id));
      }

      const [siteRow, equipmentTypes] = await Promise.all([
        getSite(accessToken, assetRow.siteId),
        listEquipmentTypes(accessToken),
      ]);
      setSite(siteRow);
      setEquipmentTypeLabel(equipmentTypes.find((t) => t.code === assetRow.equipmentTypeCode)?.label ?? assetRow.equipmentTypeCode);

      const followUps: Promise<void>[] = [
        getCustomer(accessToken, siteRow.customerId).then(setCustomer),
      ];
      if (assetRow.equipmentSystemId) {
        followUps.push(getEquipmentSystem(accessToken, assetRow.equipmentSystemId).then(setEquipmentSystem));
      }
      if (assetRow.parentAssetId) {
        followUps.push(getAsset(accessToken, assetRow.parentAssetId).then(setParentAsset));
      }
      if (assetRow.capacityUnitCode) {
        followUps.push(
          listCapacityUnits(accessToken).then((units: CapacityUnit[]) => {
            setCapacityUnitLabel(units.find((u) => u.code === assetRow.capacityUnitCode)?.label ?? assetRow.capacityUnitCode);
          }),
        );
      }
      await Promise.all(followUps);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load asset.");
    }
  }, [accessToken, params.id, hasPermission]);

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
        <Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Customers", href: "/customers" }, { label: "Equipment" }]} />
        <ErrorState message={error} onRetry={load} />
      </main>
    );
  }

  if (!asset) {
    return (
      <main className="container py-8">
        <Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Customers", href: "/customers" }, { label: "Equipment" }]} />
        <LoadingState label="Loading equipment…" />
      </main>
    );
  }

  return (
    <main className="container py-8">
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Customers", href: "/customers" },
          { label: customer?.name ?? "Customer", href: customer ? `/customers/${customer.id}` : undefined },
          { label: site?.label ?? "Site", href: site ? `/sites/${site.id}` : undefined },
          { label: asset.assetTag },
        ]}
      />
      <PageHeader title={asset.assetTag} description={equipmentTypeLabel ?? asset.equipmentTypeCode} actions={<StatusBadge status={asset.status} />} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Equipment profile</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Equipment type" value={equipmentTypeLabel ?? asset.equipmentTypeCode} />
            <Field label="Brand" value={asset.brand} />
            <Field label="Model no." value={asset.modelNo} />
            <Field label="Serial no." value={asset.serialNo} />
            <Field
              label="Capacity"
              value={asset.capacityValue ? `${asset.capacityValue} ${capacityUnitLabel ?? asset.capacityUnitCode ?? ""}` : null}
            />
            <Field label="Refrigerant" value={asset.refrigerantType} />
            <Field label="Location at site" value={asset.locationInSite} />
            <Field label="Installed" value={asset.installDate ? new Date(asset.installDate).toLocaleDateString() : null} />
            <Field label="Warranty expiry" value={asset.warrantyExpiry ? new Date(asset.warrantyExpiry).toLocaleDateString() : null} />
            <Field label="Notes" value={asset.notes} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Relationships</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field
              label="Equipment system"
              value={
                equipmentSystem ? (
                  <a href={`/sites/${site?.id}`} className="text-primary hover:underline">
                    {equipmentSystem.name}
                  </a>
                ) : null
              }
            />
            <Field
              label="Parent equipment"
              value={parentAsset ? <a href={`/assets/${parentAsset.id}`} className="text-primary hover:underline">{parentAsset.assetTag}</a> : null}
            />
            <Field label="Site" value={site ? <a href={`/sites/${site.id}`} className="text-primary hover:underline">{site.label}</a> : null} />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Service history</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? <p className="text-sm text-muted-foreground">No verified Service Reports are linked to this equipment yet.</p> :
            <ul className="space-y-2">{history.map((report) => <li key={report.id} className="flex items-center justify-between border-b py-2 text-sm">
              <Link className="font-medium text-primary hover:underline" href={`/service-reports/${report.id}/${report.status === "VERIFIED" ? "verify" : "canonical"}`}>{report.serviceReportNumber}</Link>
              <span>{new Date(report.serviceDate ?? report.uploadedAt).toLocaleDateString()}</span>
            </li>)}</ul>}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Documents</CardTitle>
        </CardHeader>
        <CardContent>
          <DocumentPanel relatedType="ASSET" relatedId={asset.id} />
        </CardContent>
      </Card>
    </main>
  );
}
