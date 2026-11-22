"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { applyCleaningScope, createTestingItem, deleteTestingItem, updateTestingItem, type QuotationTestingCommissioningItem } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SuggestedInput, useQuotationSuggestions } from "./suggested-input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export function TestingItemsPanel({
  quotationId,
  revisionId,
  canEdit,
  items,
  onChanged,
}: {
  quotationId: string;
  revisionId: string;
  canEdit: boolean;
  items: QuotationTestingCommissioningItem[];
  onChanged: () => void;
}) {
  const { accessToken } = useAuth();
  const { history, remember } = useQuotationSuggestions();
  const [newDescription, setNewDescription] = useState("");
  const [newMethod, setNewMethod] = useState("");
  const [newIndications, setNewIndications] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (!accessToken || !newDescription.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createTestingItem(accessToken, quotationId, revisionId, { description: newDescription.trim(), method: newMethod.trim() || undefined, indications: newIndications.trim() || undefined });
      remember("checklistItem", newDescription);
      setNewDescription("");
      setNewMethod("");
      setNewIndications("");
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to add item.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSampleScope() {
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try { await applyCleaningScope(accessToken, quotationId, revisionId); onChanged(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Could not apply the cleaning scope."); }
    finally { setSubmitting(false); }
  }

  async function handleToggle(item: QuotationTestingCommissioningItem) {
    if (!accessToken) return;
    setError(null);
    try {
      await updateTestingItem(accessToken, quotationId, revisionId, item.id, { included: !item.included });
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to update item.");
    }
  }

  async function handleDelete(item: QuotationTestingCommissioningItem) {
    if (!accessToken) return;
    setError(null);
    try {
      await deleteTestingItem(accessToken, quotationId, revisionId, item.id);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to delete item.");
    }
  }

  return (
    <Card className="shadow-none">
      <CardHeader className="p-4 pb-2 sm:px-5">
        <CardTitle className="text-base">Scope &amp; testing checklist</CardTitle>
        <p className="text-xs text-muted-foreground">Included items appear in the quotation PDF appendix and become Work Order tasks.</p>
      </CardHeader>
      <CardContent className="space-y-3 px-4 pb-4 pt-0 sm:px-5">
        {items.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground">No checklist items added.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-start gap-3 p-2.5">
                <input
                  type="checkbox"
                  checked={item.included}
                  onChange={() => canEdit && handleToggle(item)}
                  disabled={!canEdit}
                  className="h-4 w-4 rounded border-input"
                  aria-label={item.description}
                />
                <span className={`min-w-0 flex-1 whitespace-pre-wrap text-sm ${item.included ? "" : "text-muted-foreground line-through"}`}>
                  {item.description}
                  {(item.method || item.indications) && <span className="mt-1 block text-xs text-muted-foreground">{item.method && <>Description: {item.method}<br /></>}{item.indications && <>Indications: {item.indications}</>}</span>}
                </span>
                {canEdit && (
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(item)} aria-label="Delete checklist item">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
                {canEdit && <ScopeItemEditor item={item} onSave={async (values) => {
                  if (!accessToken) return;
                  await updateTestingItem(accessToken, quotationId, revisionId, item.id, values);
                  onChanged();
                }} />}
              </li>
            ))}
          </ul>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {canEdit && (
          <form onSubmit={handleAdd} className="space-y-2">
            {items.length === 0 && <Button type="button" size="sm" variant="outline" disabled={submitting} onClick={handleSampleScope}>Use sample general cleaning scope</Button>}
            <SuggestedInput placeholder="e.g. Phase Sequence Test" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} suggestions={history.checklistItem ?? []} maxLength={200} aria-label="New checklist item" />
            <div className="grid gap-2 sm:grid-cols-2"><Textarea aria-label="New checklist description / method" placeholder="Description / method (optional)" value={newMethod} onChange={(e) => setNewMethod(e.target.value)} rows={2} /><Textarea aria-label="New checklist indications" placeholder="Indications (optional)" value={newIndications} onChange={(e) => setNewIndications(e.target.value)} rows={2} /></div>
            <Button type="submit" variant="outline" size="sm" disabled={submitting || !newDescription.trim()}>
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function ScopeItemEditor({ item, onSave }: { item: QuotationTestingCommissioningItem; onSave: (values: { description: string; method: string; indications: string }) => Promise<void> }) {
  const [description, setDescription] = useState(item.description);
  const [method, setMethod] = useState(item.method ?? "");
  const [indications, setIndications] = useState(item.indications ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <details className="w-full text-sm">
    <summary className="cursor-pointer font-medium text-primary">Edit scope details</summary>
    <div className="mt-2 space-y-2">
      <Label htmlFor={`scope-${item.id}`}>Scope of work</Label><Textarea id={`scope-${item.id}`} value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} rows={2} />
      <Label htmlFor={`method-${item.id}`}>Description / method</Label><Textarea id={`method-${item.id}`} value={method} onChange={(e) => setMethod(e.target.value)} rows={2} />
      <Label htmlFor={`indications-${item.id}`}>Indications</Label><Textarea id={`indications-${item.id}`} value={indications} onChange={(e) => setIndications(e.target.value)} rows={2} />
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <Button type="button" size="sm" variant="outline" disabled={busy || !description.trim()} onClick={async () => { setBusy(true); setError(null); try { await onSave({ description: description.trim(), method, indications }); } catch (e) { setError(e instanceof Error ? e.message : "Could not save scope details."); } finally { setBusy(false); } }}>{busy ? "Saving…" : "Save scope details"}</Button>
    </div>
  </details>;
}
