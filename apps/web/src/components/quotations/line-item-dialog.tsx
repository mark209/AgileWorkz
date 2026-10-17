"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  createLineItem,
  TAX_TREATMENT_LABEL,
  updateLineItem,
  type Asset,
  type QuotationLineItem,
  type QuotationSection,
  type TaxTreatment,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InternalPanel } from "@/components/shared/internal-panel";

type CostingMode = "direct" | "cost_markup";

function numberError(value: string, label: string, positive = false): string | null {
  if (value.trim() === "") return `${label} is required.`;
  const number = Number(value);
  if (!Number.isFinite(number)) return `Enter a valid ${label.toLowerCase()}.`;
  if (positive && number <= 0) return `${label} must be greater than zero.`;
  return null;
}

export function LineItemDialog({
  open,
  onOpenChange,
  quotationId,
  revisionId,
  sections,
  assets,
  defaultTaxTreatment,
  editingItem,
  defaultSectionId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quotationId: string;
  revisionId: string;
  sections: QuotationSection[];
  assets: Asset[];
  defaultTaxTreatment: TaxTreatment;
  editingItem: QuotationLineItem | null;
  defaultSectionId?: string | null;
  onSaved: () => void;
}) {
  const { accessToken } = useAuth();
  const isEdit = editingItem !== null;

  const [description, setDescription] = useState(editingItem?.description ?? "");
  const [specification, setSpecification] = useState(editingItem?.specification ?? "");
  const [brand, setBrand] = useState(editingItem?.brand ?? "");
  const [model, setModel] = useState(editingItem?.model ?? "");
  const [quantity, setQuantity] = useState(editingItem?.quantity ?? "1");
  const [unit, setUnit] = useState(editingItem?.unit ?? "lot");
  const [costingMode, setCostingMode] = useState<CostingMode>(editingItem?.unitCostExpense ? "cost_markup" : "direct");
  const [unitCostExpense, setUnitCostExpense] = useState(editingItem?.unitCostExpense ?? "");
  const [markupPercent, setMarkupPercent] = useState(editingItem?.markupPercent ?? "");
  const [unitPriceBeforeVat, setUnitPriceBeforeVat] = useState(editingItem?.unitPriceBeforeVat ?? "");
  const [taxTreatment, setTaxTreatment] = useState<TaxTreatment>(editingItem?.taxTreatment ?? defaultTaxTreatment);
  const [sectionId, setSectionId] = useState(editingItem?.sectionId ?? defaultSectionId ?? "");
  const [assetId, setAssetId] = useState(editingItem?.assetId ?? "");
  const [showBreakdown, setShowBreakdown] = useState(!!(editingItem?.materialAmount || editingItem?.laborAmount));
  const [materialAmount, setMaterialAmount] = useState(editingItem?.materialAmount ?? "");
  const [laborAmount, setLaborAmount] = useState(editingItem?.laborAmount ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);

  const fieldErrors = attemptedSubmit ? {
    description: description.trim() ? null : "Description is required.",
    quantity: numberError(quantity, "Quantity", true),
    unit: unit.trim() ? null : "Unit is required.",
    price: costingMode === "direct" ? numberError(unitPriceBeforeVat, "Unit selling price") : null,
    cost: costingMode === "cost_markup" ? numberError(unitCostExpense, "Unit cost") : null,
    markup: costingMode === "cost_markup" ? numberError(markupPercent, "Markup") : null,
  } : null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setAttemptedSubmit(true);
    if (
      !description.trim() || !unit.trim() || numberError(quantity, "Quantity", true) ||
      (costingMode === "direct" ? numberError(unitPriceBeforeVat, "Unit selling price") :
        numberError(unitCostExpense, "Unit cost") || numberError(markupPercent, "Markup"))
    ) return;
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        description,
        specification: specification || undefined,
        brand: brand || undefined,
        model: model || undefined,
        quantity: Number(quantity),
        unit,
        unitCostExpense: costingMode === "cost_markup" ? Number(unitCostExpense) : isEdit ? null : undefined,
        markupPercent: costingMode === "cost_markup" ? Number(markupPercent) : isEdit ? null : undefined,
        unitPriceBeforeVat: costingMode === "direct" ? Number(unitPriceBeforeVat) : undefined,
        taxTreatment,
        materialAmount: showBreakdown && materialAmount !== "" ? Number(materialAmount) : isEdit ? null : undefined,
        laborAmount: showBreakdown && laborAmount !== "" ? Number(laborAmount) : isEdit ? null : undefined,
        sectionId: sectionId || (isEdit ? null : undefined),
        assetId: assetId || (isEdit ? null : undefined),
      };
      if (isEdit) {
        await updateLineItem(accessToken, quotationId, revisionId, editingItem.id, body);
      } else {
        await createLineItem(accessToken, quotationId, revisionId, body);
      }
      onOpenChange(false);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save line item.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!submitting || next) onOpenChange(next); }}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <form onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit line item" : "Add line item"}</DialogTitle>
            <DialogDescription>Selling information the customer will see, plus optional internal costing.</DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="li-description">Description</Label>
              <Input id="li-description" value={description} onChange={(e) => setDescription(e.target.value)} required aria-invalid={!!fieldErrors?.description} aria-describedby={fieldErrors?.description ? "li-description-error" : undefined} />
              {fieldErrors?.description && <p id="li-description-error" className="text-xs text-destructive">{fieldErrors.description}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="li-spec">Specification (optional)</Label>
              <Textarea id="li-spec" value={specification} onChange={(e) => setSpecification(e.target.value)} rows={2} />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="li-brand">Brand (optional)</Label>
                <Input id="li-brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="li-model">Model (optional)</Label>
                <Input id="li-model" value={model} onChange={(e) => setModel(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="li-qty">Quantity</Label>
                <Input id="li-qty" type="number" min="0.001" step="0.001" value={quantity} onChange={(e) => setQuantity(e.target.value)} required aria-invalid={!!fieldErrors?.quantity} aria-describedby={fieldErrors?.quantity ? "li-qty-error" : undefined} />
                {fieldErrors?.quantity && <p id="li-qty-error" className="text-xs text-destructive">{fieldErrors.quantity}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="li-unit">Unit</Label>
                <Input id="li-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="pcs, lot, set, m" required aria-invalid={!!fieldErrors?.unit} aria-describedby={fieldErrors?.unit ? "li-unit-error" : undefined} />
                {fieldErrors?.unit && <p id="li-unit-error" className="text-xs text-destructive">{fieldErrors.unit}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="li-tax">Tax treatment</Label>
                <Select id="li-tax" value={taxTreatment} onChange={(e) => setTaxTreatment(e.target.value as TaxTreatment)}>
                  {Object.entries(TAX_TREATMENT_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-muted-foreground">
                  {taxTreatment === "VAT_INCLUSIVE"
                    ? "Enter the unit selling price before VAT. The calculated customer total includes VAT."
                    : "No VAT is added or extracted. The entered unit selling price is the final price."}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="li-section">Section (optional)</Label>
                <Select id="li-section" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
                  <option value="">— Ungrouped —</option>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-muted-foreground">Group this item under a quotation section, or leave it ungrouped.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="li-asset">Linked asset (optional)</Label>
                <Select id="li-asset" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
                  <option value="">— None —</option>
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.assetTag}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-muted-foreground">Link an existing site asset only when this item concerns that equipment.</p>
              </div>
            </div>

            <div>
              <button
                type="button"
                className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                onClick={() => setShowBreakdown((v) => !v)}
              >
                {showBreakdown ? "Hide" : "Add"} selling-price breakdown (material / labor)
              </button>
              {showBreakdown && (
                <div className="mt-2 grid grid-cols-1 gap-3 rounded-md border p-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="li-material">Material amount</Label>
                    <Input id="li-material" type="number" step="0.01" value={materialAmount} onChange={(e) => setMaterialAmount(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="li-labor">Labor amount</Label>
                    <Input id="li-labor" type="number" step="0.01" value={laborAmount} onChange={(e) => setLaborAmount(e.target.value)} />
                  </div>
                  <p className="col-span-2 text-xs text-muted-foreground">
                    If both are provided, they must sum to the selling price before VAT.
                  </p>
                </div>
              )}
            </div>

            <InternalPanel>
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={costingMode === "direct" ? "default" : "outline"}
                    onClick={() => setCostingMode("direct")}
                  >
                    Direct selling price
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={costingMode === "cost_markup" ? "default" : "outline"}
                    onClick={() => setCostingMode("cost_markup")}
                  >
                    Cost + markup
                  </Button>
                </div>

                {costingMode === "direct" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="li-price">Unit selling price before VAT</Label>
                    <Input
                      id="li-price"
                      type="number"
                      step="0.01"
                      value={unitPriceBeforeVat}
                      onChange={(e) => setUnitPriceBeforeVat(e.target.value)}
                      required={costingMode === "direct"}
                      aria-invalid={!!fieldErrors?.price}
                      aria-describedby={fieldErrors?.price ? "li-price-error" : undefined}
                    />
                    {fieldErrors?.price && <p id="li-price-error" className="text-xs text-destructive">{fieldErrors.price}</p>}
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="li-cost">Unit cost / expense</Label>
                        <Input
                          id="li-cost"
                          type="number"
                          step="0.01"
                          value={unitCostExpense}
                          onChange={(e) => setUnitCostExpense(e.target.value)}
                          required={costingMode === "cost_markup"}
                          aria-invalid={!!fieldErrors?.cost}
                          aria-describedby={fieldErrors?.cost ? "li-cost-error" : undefined}
                        />
                        {fieldErrors?.cost && <p id="li-cost-error" className="text-xs text-destructive">{fieldErrors.cost}</p>}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="li-markup">Markup %</Label>
                        <Input
                          id="li-markup"
                          type="number"
                          step="0.01"
                          value={markupPercent}
                          onChange={(e) => setMarkupPercent(e.target.value)}
                          required={costingMode === "cost_markup"}
                          aria-invalid={!!fieldErrors?.markup}
                          aria-describedby={fieldErrors?.markup ? "li-markup-error" : undefined}
                        />
                        {fieldErrors?.markup && <p id="li-markup-error" className="text-xs text-destructive">{fieldErrors.markup}</p>}
                      </div>
                    </div>
                    <p className="text-xs text-amber-800">
                      Selling price, gross profit, and gross margin are calculated automatically after saving.
                    </p>
                  </>
                )}
              </div>
            </InternalPanel>

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter className="mt-6">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : isEdit ? "Save changes" : "Add line item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
