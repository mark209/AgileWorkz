"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { listPendingReferenceSuggestions, reviewReferenceSuggestion, QUOTATION_TYPE_LABEL, type ReferenceSuggestion } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function ReferenceSuggestionsPage() {
  const { user, accessToken, hasPermission, isLoading } = useAuth();
  const router = useRouter();
  const canManage = hasPermission("system_settings", "manage");
  const [items, setItems] = useState<ReferenceSuggestion[] | null>(null);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!accessToken || !canManage) return false;
    setItems(null); setLoadError(null);
    try { setItems(await listPendingReferenceSuggestions(accessToken)); return true; }
    catch (e) { setLoadError(e instanceof ApiError ? e.message : "Could not load suggestions."); return false; }
  }, [accessToken, canManage]);
  useEffect(() => { if (!isLoading && !user) router.replace("/login"); }, [isLoading, user, router]);
  useEffect(() => { void load(); }, [load]);

  async function review(item: ReferenceSuggestion, approved: boolean) {
    if (!accessToken) return;
    const code = codes[item.id]?.trim().toUpperCase();
    if (approved && item.kind !== "QUOTATION_TYPE" && !code) { setError("Enter a code before approving this choice."); return; }
    if (!window.confirm(`${approved ? "Approve" : "Decline"} “${item.label}”?`)) return;
    setBusyId(item.id); setError(null); setMessage(null);
    try {
      await reviewReferenceSuggestion(accessToken, item.id, { approved, code: approved ? code : undefined });
      const refreshed = await load();
      setMessage(refreshed
        ? (approved ? "Choice approved and added to the shared options." : "Choice declined. The original record keeps its typed label.")
        : "Choice reviewed. Try again to refresh the list.");
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not review this choice."); }
    finally { setBusyId(null); }
  }

  if (isLoading || !user) return null;
  if (!canManage) return <main className="p-6"><h1 className="text-xl font-semibold">Access denied</h1><p>You cannot review shared choices.</p></main>;
  return <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
    <PageHeader title="Review shared choices" description="Review employee-entered choices before adding them to the lists used by everyone." />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {loadError && <div role="alert" className="flex items-center gap-3 text-sm text-destructive"><span>{loadError}</span><Button variant="outline" size="sm" onClick={() => { setMessage(null); void load(); }}>Try again</Button></div>}
    {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
    {items === null && !loadError && <p role="status" className="text-sm text-muted-foreground">Loading choices…</p>}
    {items?.length === 0 && <p className="rounded-lg border bg-card p-4 sm:p-5 text-sm text-muted-foreground">No choices await review.</p>}
    {items?.map((item) => <div key={item.id} className="space-y-3 rounded-lg border bg-card p-4 sm:p-5">
      <div><p className="font-medium">{item.label}</p><p className="text-sm text-muted-foreground">{item.kind === "QUOTATION_TYPE" ? "Quotation type" : item.kind === "TRADE" ? "Trade" : item.kind === "INQUIRY_SOURCE" ? "Inquiry source" : "Inquiry type"}{item.operationalType ? ` · Work Order behavior: ${QUOTATION_TYPE_LABEL[item.operationalType]}` : ""} · Suggested {formatDateTime(item.createdAt)}{items.filter((other) => other.kind === item.kind && other.label.toLowerCase() === item.label.toLowerCase()).length > 1 ? ` · Suggestion ${item.id.slice(0, 8)}` : ""}</p></div>
      {item.kind !== "QUOTATION_TYPE" && <div className="space-y-1"><label htmlFor={`choice-code-${item.id}`} className="text-sm font-medium">Shared option code</label><Input id={`choice-code-${item.id}`} value={codes[item.id] ?? ""} onChange={(e) => setCodes((previous) => ({ ...previous, [item.id]: e.target.value.toUpperCase() }))} placeholder={item.kind === "TRADE" ? "e.g. COLD_ROOM" : item.kind === "INQUIRY_SOURCE" ? "e.g. REFERRAL" : "e.g. SERVICE_REQUEST"} maxLength={30} className="max-w-xs" /><p className="text-xs text-muted-foreground">Used internally to identify this choice in the shared list.</p></div>}
      <div className="flex gap-2"><Button disabled={busyId !== null} onClick={() => void review(item, true)}>Approve</Button><Button variant="outline" disabled={busyId !== null} onClick={() => void review(item, false)}>Decline</Button></div>
    </div>)}
  </main>;
}
