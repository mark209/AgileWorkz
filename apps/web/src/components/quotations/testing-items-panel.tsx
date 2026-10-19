"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { createTestingItem, deleteTestingItem, updateTestingItem, type QuotationTestingCommissioningItem } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SuggestedInput, useQuotationSuggestions } from "./suggested-input";

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (!accessToken || !newDescription.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createTestingItem(accessToken, quotationId, revisionId, { description: newDescription.trim() });
      remember("checklistItem", newDescription);
      setNewDescription("");
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to add item.");
    } finally {
      setSubmitting(false);
    }
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
        <CardTitle className="text-base">Testing &amp; commissioning checklist</CardTitle>
        <p className="text-xs text-muted-foreground">Track the checks included before handover.</p>
      </CardHeader>
      <CardContent className="space-y-3 px-4 pb-4 pt-0 sm:px-5">
        {items.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground">No checklist items added.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 p-2.5">
                <input
                  type="checkbox"
                  checked={item.included}
                  onChange={() => canEdit && handleToggle(item)}
                  disabled={!canEdit}
                  className="h-4 w-4 rounded border-input"
                  aria-label={item.description}
                />
                <span className={`flex-1 text-sm ${item.included ? "" : "text-muted-foreground line-through"}`}>
                  {item.description}
                </span>
                {canEdit && (
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(item)} aria-label="Delete checklist item">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {canEdit && (
          <form onSubmit={handleAdd} className="flex flex-wrap items-center gap-2">
            <SuggestedInput placeholder="e.g. Phase Sequence Test" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} suggestions={history.checklistItem ?? []} className="min-w-0 flex-1" aria-label="New checklist item" />
            <Button type="submit" variant="outline" size="sm" disabled={submitting || !newDescription.trim()}>
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
