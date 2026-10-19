"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { TAX_TREATMENT_LABEL, updateRevisionContent, type QuotationRevision, type TaxTreatment } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SuggestedInput, useQuotationSuggestions } from "./suggested-input";

type DiscountMode = "percent" | "amount";

function textUpdate(value: string, previousValue: string | null) {
  return value === "" && !previousValue ? undefined : value;
}

// DRAFT-only, per assertRevisionEditable — the parent only renders this
// editable when canEdit is true. Every save round-trips through the server
// (updateRevisionContent) and the parent refetches afterward (D7); nothing
// here computes a total.
export function RevisionFreeTextForm({
  quotationId,
  revisionId,
  canEdit,
  revision,
  onChanged,
  onDirtyChange,
}: {
  quotationId: string;
  revisionId: string;
  canEdit: boolean;
  revision: QuotationRevision;
  onChanged: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { accessToken } = useAuth();
  const { history, remember } = useQuotationSuggestions();
  const [scopeOfWork, setScopeOfWork] = useState(revision.scopeOfWork ?? "");
  const [paymentTerms, setPaymentTerms] = useState(revision.paymentTerms ?? "");
  const [warranty, setWarranty] = useState(revision.warranty ?? "");
  const [leadTime, setLeadTime] = useState(revision.leadTime ?? "");
  const [notes, setNotes] = useState(revision.notes ?? "");
  const [exclusions, setExclusions] = useState(revision.exclusions ?? "");
  const [termsAndConditions, setTermsAndConditions] = useState(revision.termsAndConditions ?? "");
  const [validUntil, setValidUntil] = useState(revision.validUntil?.slice(0, 10) ?? "");
  const [defaultTaxTreatment, setDefaultTaxTreatment] = useState<TaxTreatment>(revision.defaultTaxTreatment);
  const [discountMode, setDiscountMode] = useState<DiscountMode>(
    Number(revision.discountPercent) > 0 ? "percent" : Number(revision.discountAmount) > 0 ? "amount" : "percent",
  );
  const [discountValue, setDiscountValue] = useState(
    Number(revision.discountPercent) > 0 ? revision.discountPercent : Number(revision.discountAmount) > 0 ? revision.discountAmount : "0",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  const hasPlaceholder = termsAndConditions.includes("[PLACEHOLDER");

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    setSavedNotice(false);
    try {
      await updateRevisionContent(accessToken, quotationId, revisionId, {
        scopeOfWork: textUpdate(scopeOfWork, revision.scopeOfWork),
        paymentTerms: textUpdate(paymentTerms, revision.paymentTerms),
        warranty: textUpdate(warranty, revision.warranty),
        leadTime: textUpdate(leadTime, revision.leadTime),
        notes: textUpdate(notes, revision.notes),
        exclusions: textUpdate(exclusions, revision.exclusions),
        termsAndConditions: textUpdate(termsAndConditions, revision.termsAndConditions),
        validUntil: validUntil || undefined,
        defaultTaxTreatment,
        discountPercent: discountMode === "percent" ? Number(discountValue) : undefined,
        discountAmount: discountMode === "amount" ? Number(discountValue) : undefined,
      });
      remember("leadTime", leadTime);
      setSavedNotice(true);
      onDirtyChange?.(false);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!canEdit) {
    return (
      <Card className="shadow-none">
        <CardHeader className="p-4 pb-2 sm:px-5">
          <CardTitle className="text-base">Quotation details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 px-4 pb-4 pt-0 sm:grid-cols-2 sm:px-5">
          <ReadField label="Scope of work" value={revision.scopeOfWork} />
          <ReadField label="Payment terms" value={revision.paymentTerms} />
          <ReadField label="Warranty" value={revision.warranty} />
          <ReadField label="Lead time" value={revision.leadTime} />
          <ReadField label="Notes" value={revision.notes} />
          <ReadField label="Exclusions" value={revision.exclusions} />
          <div className="sm:col-span-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Terms &amp; conditions</p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{revision.termsAndConditions || "—"}</p>
          </div>
          <div id="quotation-commercial-terms" className="scroll-mt-6 border-t pt-4 sm:col-span-2">
            <h3 className="mb-3 text-base font-semibold">Commercial terms</h3>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <ReadField label="Default tax treatment" value={TAX_TREATMENT_LABEL[revision.defaultTaxTreatment]} />
              <ReadField label="Discount" value={Number(revision.discountPercent) > 0 ? `${revision.discountPercent}%` : formatMoney(revision.discountAmount)} />
            </dl>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-none">
      <CardHeader className="p-4 pb-2 sm:px-5">
        <CardTitle className="text-base">Quotation details</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0 sm:px-5">
        <form onSubmit={handleSave} onChangeCapture={() => { setSavedNotice(false); onDirtyChange?.(true); }} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rf-scope">Scope of work</Label>
            <Textarea id="rf-scope" value={scopeOfWork} onChange={(e) => setScopeOfWork(e.target.value)} rows={3} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rf-payment">Payment terms</Label>
              <Textarea id="rf-payment" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} rows={2} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rf-warranty">Warranty</Label>
              <Textarea id="rf-warranty" value={warranty} onChange={(e) => setWarranty(e.target.value)} rows={2} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rf-leadtime">Lead time</Label>
              <SuggestedInput id="rf-leadtime" value={leadTime} onChange={(e) => setLeadTime(e.target.value)} suggestions={history.leadTime ?? []} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rf-valid-until">Valid until</Label>
              <Input id="rf-valid-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rf-notes">Notes</Label>
              <Textarea id="rf-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rf-exclusions">Exclusions</Label>
              <Textarea id="rf-exclusions" value={exclusions} onChange={(e) => setExclusions(e.target.value)} rows={2} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rf-tc">Terms &amp; conditions</Label>
            <Textarea id="rf-tc" value={termsAndConditions} onChange={(e) => setTermsAndConditions(e.target.value)} rows={5} />
            {hasPlaceholder && (
              <p className="flex items-center gap-1.5 text-xs text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                This still contains placeholder text — replace it before sending to the customer. Sending is blocked
                while it remains.
              </p>
            )}
          </div>

          <div id="quotation-commercial-terms" className="grid scroll-mt-6 grid-cols-1 gap-3 border-t pt-4 sm:grid-cols-3">
            <h3 className="text-base font-semibold sm:col-span-3">Commercial terms</h3>
            <div className="space-y-1.5">
              <Label htmlFor="rf-tax">Default tax treatment</Label>
              <Select id="rf-tax" value={defaultTaxTreatment} onChange={(e) => setDefaultTaxTreatment(e.target.value as TaxTreatment)}>
                {Object.entries(TAX_TREATMENT_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                Applies to new line items; each line can be changed separately. For VAT Inclusive, the calculated total includes VAT added to the entered pre-VAT price. VAT Exempt adds no VAT.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rf-discount-mode">Discount</Label>
              <Select id="rf-discount-mode" value={discountMode} onChange={(e) => setDiscountMode(e.target.value as DiscountMode)}>
                <option value="percent">Percent of subtotal</option>
                <option value="amount">Fixed amount</option>
              </Select>
              <p className="text-xs text-muted-foreground">Choose whether the discount is a percentage or a fixed amount.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rf-discount-value">{discountMode === "percent" ? "Discount %" : "Discount (₱)"}</Label>
              <Input
                id="rf-discount-value"
                type="number"
                min="0"
                step="0.01"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
              />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {savedNotice && !error && <p className="text-sm text-emerald-700">Saved — totals recalculated.</p>}

          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Save details and commercial terms"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ReadField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm">{value || "—"}</p>
    </div>
  );
}
