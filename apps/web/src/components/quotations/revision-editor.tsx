"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  createSection,
  deleteLineItem,
  deleteSection,
  reorderSections,
  updateSection,
  type Asset,
  type QuotationLineItem,
  type QuotationSection,
  type TaxTreatment,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { formatMoney, formatPercent } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/states";
import { InternalPanel } from "@/components/shared/internal-panel";
import { LineItemDialog } from "./line-item-dialog";

function LineItemsTable({
  items,
  canEdit,
  onEdit,
  onDelete,
}: {
  items: QuotationLineItem[];
  canEdit: boolean;
  onEdit: (item: QuotationLineItem) => void;
  onDelete: (item: QuotationLineItem) => void;
}) {
  if (items.length === 0) {
    return <p className="px-2 py-4 text-sm text-muted-foreground">No line items in this group yet.</p>;
  }
  const hasInternalCosting = items.some((i) => i.unitCostExpense !== null);
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead>Qty</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Unit Price</TableHead>
              <TableHead>Tax</TableHead>
              <TableHead>Line Total</TableHead>
              {canEdit && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <p className="font-medium">{item.description}</p>
                  {(item.brand || item.model) && (
                    <p className="text-xs text-muted-foreground">{[item.brand, item.model].filter(Boolean).join(" · ")}</p>
                  )}
                </TableCell>
                <TableCell>
                  {item.quantity} {item.unit}
                </TableCell>
                <TableCell>{item.unit}</TableCell>
                <TableCell>{formatMoney(item.unitPrice)}</TableCell>
                <TableCell>{item.taxTreatment === "VAT_INCLUSIVE" ? "VAT Inc." : "VAT EX"}</TableCell>
                <TableCell className="font-medium">{formatMoney(item.lineFinalAmount)}</TableCell>
                {canEdit && (
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => onEdit(item)} aria-label="Edit line item">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => onDelete(item)} aria-label="Delete line item">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {hasInternalCosting && (
        <InternalPanel title="Internal costing — this group">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Unit Cost</TableHead>
                  <TableHead>Markup %</TableHead>
                  <TableHead>Gross Profit</TableHead>
                  <TableHead>Gross Margin %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items
                  .filter((i) => i.unitCostExpense !== null)
                  .map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.description}</TableCell>
                      <TableCell>{formatMoney(item.unitCostExpense)}</TableCell>
                      <TableCell>{formatPercent(item.markupPercent)}</TableCell>
                      <TableCell>{formatMoney(item.grossProfitAmount)}</TableCell>
                      <TableCell>{formatPercent(item.grossMarginPercent)}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </InternalPanel>
      )}
    </div>
  );
}

export function RevisionEditor({
  quotationId,
  revisionId,
  canEdit,
  sections,
  lineItems,
  assets,
  defaultTaxTreatment,
  onChanged,
}: {
  quotationId: string;
  revisionId: string;
  canEdit: boolean;
  sections: QuotationSection[];
  lineItems: QuotationLineItem[];
  assets: Asset[];
  defaultTaxTreatment: TaxTreatment;
  onChanged: () => void;
}) {
  const { accessToken } = useAuth();
  const [newSectionName, setNewSectionName] = useState("");
  const [addingSection, setAddingSection] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lineDialogOpen, setLineDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<QuotationLineItem | null>(null);
  const [presetSectionId, setPresetSectionId] = useState<string | null>(null);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingSectionName, setEditingSectionName] = useState("");

  const sortedSections = [...sections].sort((a, b) => a.sortOrder - b.sortOrder);
  const ungrouped = lineItems.filter((i) => !i.sectionId);

  function openAddLine(sectionId: string | null) {
    setEditingItem(null);
    setPresetSectionId(sectionId);
    setLineDialogOpen(true);
  }
  function openEditLine(item: QuotationLineItem) {
    setEditingItem(item);
    setPresetSectionId(item.sectionId);
    setLineDialogOpen(true);
  }

  async function handleDeleteLine(item: QuotationLineItem) {
    if (!accessToken) return;
    setError(null);
    try {
      await deleteLineItem(accessToken, quotationId, revisionId, item.id);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to delete line item.");
    }
  }

  async function handleAddSection(event: React.FormEvent) {
    event.preventDefault();
    if (!accessToken || !newSectionName.trim()) return;
    setAddingSection(true);
    setError(null);
    try {
      await createSection(accessToken, quotationId, revisionId, { name: newSectionName.trim() });
      setNewSectionName("");
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to add section.");
    } finally {
      setAddingSection(false);
    }
  }

  async function handleRenameSection(section: QuotationSection) {
    if (!accessToken || !editingSectionName.trim()) return;
    setError(null);
    try {
      await updateSection(accessToken, quotationId, revisionId, section.id, { name: editingSectionName.trim() });
      setEditingSectionId(null);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to rename section.");
    }
  }

  async function handleDeleteSection(section: QuotationSection) {
    if (!accessToken) return;
    setError(null);
    try {
      await deleteSection(accessToken, quotationId, revisionId, section.id);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to delete section.");
    }
  }

  async function moveSection(index: number, direction: -1 | 1) {
    if (!accessToken) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= sortedSections.length) return;
    const reordered = [...sortedSections];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    setError(null);
    try {
      await reorderSections(accessToken, quotationId, revisionId, reordered.map((s) => s.id));
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to reorder sections.");
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-destructive">{error}</p>}

      {sortedSections.map((section, index) => {
        const items = lineItems.filter((i) => i.sectionId === section.id);
        return (
          <Card key={section.id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              {editingSectionId === section.id ? (
                <div className="flex flex-1 items-center gap-2">
                  <Input
                    value={editingSectionName}
                    onChange={(e) => setEditingSectionName(e.target.value)}
                    className="h-8 max-w-xs"
                    autoFocus
                  />
                  <Button size="sm" onClick={() => handleRenameSection(section)}>
                    Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingSectionId(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <CardTitle className="text-base">{section.name}</CardTitle>
              )}
              {canEdit && editingSectionId !== section.id && (
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={() => moveSection(index, -1)} disabled={index === 0} aria-label="Move section up">
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => moveSection(index, 1)}
                    disabled={index === sortedSections.length - 1}
                    aria-label="Move section down"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setEditingSectionId(section.id);
                      setEditingSectionName(section.name);
                    }}
                    aria-label="Rename section"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDeleteSection(section)} aria-label="Delete section">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              <LineItemsTable items={items} canEdit={canEdit} onEdit={openEditLine} onDelete={handleDeleteLine} />
              {canEdit && (
                <Button variant="outline" size="sm" className="mt-3" onClick={() => openAddLine(section.id)}>
                  <Plus className="mr-1 h-4 w-4" /> Add line item
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{sortedSections.length > 0 ? "Ungrouped line items" : "Line items"}</CardTitle>
        </CardHeader>
        <CardContent>
          {ungrouped.length === 0 && sortedSections.length === 0 ? (
            <EmptyState title="No line items yet" description="Add the first line item to start building this quotation." />
          ) : (
            <LineItemsTable items={ungrouped} canEdit={canEdit} onEdit={openEditLine} onDelete={handleDeleteLine} />
          )}
          {canEdit && (
            <Button variant="outline" size="sm" className="mt-3" onClick={() => openAddLine(null)}>
              <Plus className="mr-1 h-4 w-4" /> Add line item
            </Button>
          )}
        </CardContent>
      </Card>

      {canEdit && (
        <form onSubmit={handleAddSection} className="flex items-center gap-2">
          <Input
            placeholder="New section name (e.g. Airconditioning Works)"
            value={newSectionName}
            onChange={(e) => setNewSectionName(e.target.value)}
            className="max-w-sm"
          />
          <Button type="submit" variant="outline" size="sm" disabled={addingSection || !newSectionName.trim()}>
            <Plus className="mr-1 h-4 w-4" /> Add section
          </Button>
        </form>
      )}

      <LineItemDialog
        key={editingItem?.id ?? `new-${presetSectionId ?? "ungrouped"}`}
        open={lineDialogOpen}
        onOpenChange={setLineDialogOpen}
        quotationId={quotationId}
        revisionId={revisionId}
        sections={sortedSections}
        assets={assets}
        defaultTaxTreatment={defaultTaxTreatment}
        editingItem={editingItem}
        defaultSectionId={presetSectionId}
        onSaved={onChanged}
      />
    </div>
  );
}
