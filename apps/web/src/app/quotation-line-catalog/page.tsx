"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { createQuotationLineCatalogItem, listQuotationLineCatalog, setQuotationLineCatalogStatus, updateQuotationLineCatalogItem, TAX_TREATMENT_LABEL, type QuotationLineCatalogItem, type TaxTreatment } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatMoney } from "@/lib/format";

export default function QuotationLineCatalogPage() {
  const { user, accessToken, hasPermission, isLoading } = useAuth();
  const router = useRouter();
  const canManage = hasPermission("system_settings", "manage");
  const [items, setItems] = useState<QuotationLineCatalogItem[] | null>(null);
  const requestId = useRef(0);
  const [description, setDescription] = useState("");
  const [specification, setSpecification] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [unit, setUnit] = useState("");
  const [price, setPrice] = useState("");
  const [taxTreatment, setTaxTreatment] = useState<TaxTreatment>("VAT_INCLUSIVE");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!accessToken || !canManage) return false;
    const request = ++requestId.current;
    setItems(null); setLoadError(null);
    try {
      const rows = await listQuotationLineCatalog(accessToken, true);
      if (request !== requestId.current) return false;
      setItems(rows);
      return true;
    } catch (e) {
      if (request === requestId.current) setLoadError(e instanceof ApiError ? e.message : "Could not load saved line items.");
      return false;
    }
  }, [accessToken, canManage]);
  useEffect(() => { if (!isLoading && !user) router.replace("/login"); }, [isLoading, user, router]);
  useEffect(() => { void load(); }, [load]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!accessToken) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const body = { description: description.trim(), specification: specification.trim(), brand: brand.trim(), model: model.trim(), unit: unit.trim(), unitPriceBeforeVat: Number(price), taxTreatment };
      if (editingId) await updateQuotationLineCatalogItem(accessToken, editingId, body);
      else await createQuotationLineCatalogItem(accessToken, body);
      setDescription(""); setSpecification(""); setBrand(""); setModel(""); setUnit(""); setPrice(""); setEditingId(null);
      const refreshed = await load();
      setMessage(refreshed ? "Saved line item is available when adding quotation lines." : "Line item saved. Try again to refresh the list.");
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not save line item."); }
    finally { setBusy(false); }
  }

  async function deactivate(item: QuotationLineCatalogItem) {
    if (!accessToken || !window.confirm(`Deactivate “${item.description}”? Existing quotation lines will remain unchanged.`)) return;
    setBusy(true); setError(null);
    try { await setQuotationLineCatalogStatus(accessToken, item.id, "INACTIVE"); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Could not deactivate line item."); }
    finally { setBusy(false); }
  }
  if (isLoading || !user) return null;
  if (!canManage) return <main className="p-6"><h1 className="text-xl font-semibold">Access denied</h1><p>You cannot manage saved line items.</p></main>;
  return <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8"><PageHeader title="Saved line items" description="Maintain reusable quotation lines. Staff can adjust each copied line on its quotation." />
    <form onSubmit={save} className="grid max-w-3xl gap-3 rounded-lg border bg-card p-4 sm:p-5 sm:grid-cols-2">
      <div className="space-y-1"><Label htmlFor="catalog-description">Description</Label><Input id="catalog-description" value={description} onChange={(e) => setDescription(e.target.value)} required maxLength={255} /></div>
      <div className="space-y-1"><Label htmlFor="catalog-specification">Specification</Label><Input id="catalog-specification" value={specification} onChange={(e) => setSpecification(e.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="catalog-brand">Brand</Label><Input id="catalog-brand" value={brand} onChange={(e) => setBrand(e.target.value)} maxLength={100} /></div>
      <div className="space-y-1"><Label htmlFor="catalog-model">Model</Label><Input id="catalog-model" value={model} onChange={(e) => setModel(e.target.value)} maxLength={100} /></div>
      <div className="space-y-1"><Label htmlFor="catalog-unit">Unit</Label><Input id="catalog-unit" value={unit} onChange={(e) => setUnit(e.target.value)} required maxLength={30} /></div>
      <div className="space-y-1"><Label htmlFor="catalog-price">Unit selling price</Label><Input id="catalog-price" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required /></div>
      <div className="space-y-1"><Label htmlFor="catalog-tax">Tax treatment</Label><Select id="catalog-tax" value={taxTreatment} onChange={(e) => setTaxTreatment(e.target.value as TaxTreatment)}>{Object.entries(TAX_TREATMENT_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></div>
      <div className="flex gap-2"><Button type="submit" disabled={busy || !description.trim() || !unit.trim() || !price || Number(price) < 0}>{busy ? "Saving…" : editingId ? "Save changes" : "Save line item"}</Button>{editingId && <Button type="button" variant="outline" onClick={() => { setEditingId(null); setDescription(""); setSpecification(""); setBrand(""); setModel(""); setUnit(""); setPrice(""); }}>Cancel edit</Button>}</div>
    </form>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{loadError && <div role="alert" className="flex items-center gap-3 text-sm text-destructive"><span>{loadError}</span><Button type="button" variant="outline" size="sm" onClick={() => { setMessage(null); void load(); }}>Try again</Button></div>}{message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
    <div className="space-y-2"><h2 className="text-lg font-semibold">Available line items</h2>{items === null && !loadError && <p role="status" className="text-sm text-muted-foreground">Loading line items…</p>}{items?.length === 0 && <p className="text-sm text-muted-foreground">No saved line items yet.</p>}{items?.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"><div><p className="font-medium">{item.description}</p><p className="text-sm text-muted-foreground">{item.unit} · {formatMoney(item.unitPriceBeforeVat)} · {item.status === "ACTIVE" ? "Active" : "Inactive"}</p></div><div className="flex gap-2"><Button variant="outline" size="sm" disabled={busy} onClick={() => { setEditingId(item.id); setDescription(item.description); setSpecification(item.specification ?? ""); setBrand(item.brand ?? ""); setModel(item.model ?? ""); setUnit(item.unit); setPrice(item.unitPriceBeforeVat); setTaxTreatment(item.taxTreatment); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Edit</Button>{item.status === "ACTIVE" && <Button variant="outline" size="sm" disabled={busy} onClick={() => void deactivate(item)}>Deactivate</Button>}</div></div>)}</div>
  </main>;
}
