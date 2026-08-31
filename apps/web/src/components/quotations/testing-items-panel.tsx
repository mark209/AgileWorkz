"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { createTestingItem, deleteTestingItem, updateTestingItem, type QuotationTestingCommissioningItem } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/states";

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

  if (!canEdit && items.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Testing &amp; commissioning checklist</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <EmptyState title="No checklist items yet" description="What must be tested or commissioned before handover." />
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
          <form onSubmit={handleAdd} className="flex items-center gap-2">
            <Input placeholder="e.g. Phase Sequence Test" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
            <Button type="submit" variant="outline" size="sm" disabled={submitting || !newDescription.trim()}>
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
