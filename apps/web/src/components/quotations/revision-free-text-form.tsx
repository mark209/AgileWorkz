"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { listPaymentTerms, listQuotationTemplates, TAX_TREATMENT_LABEL, updateRevisionContent, type QuotationRevision, type QuotationTermTemplate, type TaxTreatment } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionConfirmDialog } from "@/components/shared/action-confirm-dialog";

type DiscountMode = "percent" | "amount";

const isDateValue = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

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
  const [scopeOfWork, setScopeOfWork] = useState(revision.scopeOfWork ?? "");
  const [paymentTerms, setPaymentTerms] = useState(revision.paymentTerms ?? "");
  const [customPayment, setCustomPayment] = useState(false);
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
  const [paymentOptions, setPaymentOptions] = useState<string[]>([]);
  const [officialTemplate, setOfficialTemplate] = useState<QuotationTermTemplate | null>(null);
  const [confirmTemplate, setConfirmTemplate] = useState(false);
  const [editVersion, setEditVersion] = useState(0);
  const latestVersion = useRef(0);
  const savedVersion = useRef(0);
  const saving = useRef(false);

  const hasPlaceholder = termsAndConditions.includes("[PLACEHOLDER");

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    listPaymentTerms(accessToken).then((values) => {
      if (active) {
        setPaymentOptions(values);
        if (paymentTerms && !values.includes(paymentTerms)) setCustomPayment(true);
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    listQuotationTemplates(accessToken).then((templates) => {
      if (active) setOfficialTemplate(templates.find((template) => template.status === "ACTIVE" && template.isDefault && !template.quotationType && !template.tradeCode && !template.body.includes("[PLACEHOLDER")) ?? null);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [accessToken]);

  const latestValues = useRef({ scopeOfWork, paymentTerms, warranty, leadTime, notes, exclusions, termsAndConditions, validUntil, defaultTaxTreatment, discountMode, discountValue, revision });
  latestValues.current = { scopeOfWork, paymentTerms, warranty, leadTime, notes, exclusions, termsAndConditions, validUntil, defaultTaxTreatment, discountMode, discountValue, revision };

  async function saveChanges() {
    if (!accessToken || saving.current) return;
    if (customPayment && !paymentTerms.trim()) {
      setError("Enter custom payment terms before saving.");
      return;
    }
    saving.current = true;
    setSubmitting(true);
    setError(null);
    setSavedNotice(false);
    try {
      while (savedVersion.current < latestVersion.current) {
        const version = latestVersion.current;
        const value = latestValues.current;
        await updateRevisionContent(accessToken, quotationId, revisionId, {
          scopeOfWork: textUpdate(value.scopeOfWork, value.revision.scopeOfWork),
          paymentTerms: textUpdate(value.paymentTerms, value.revision.paymentTerms),
          warranty: textUpdate(value.warranty, value.revision.warranty),
          leadTime: textUpdate(value.leadTime, value.revision.leadTime),
          notes: textUpdate(value.notes, value.revision.notes),
          exclusions: textUpdate(value.exclusions, value.revision.exclusions),
          termsAndConditions: textUpdate(value.termsAndConditions, value.revision.termsAndConditions),
          validUntil: value.validUntil || undefined,
          defaultTaxTreatment: value.defaultTaxTreatment,
          discountPercent: value.discountMode === "percent" ? Number(value.discountValue) : undefined,
          discountAmount: value.discountMode === "amount" ? Number(value.discountValue) : undefined,
        });
        savedVersion.current = version;
      }
      setSavedNotice(true);
      onDirtyChange?.(false);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save.");
    } finally {
      saving.current = false;
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (!canEdit || editVersion === 0) return;
    const timer = window.setTimeout(() => { void saveChanges(); }, 700);
    return () => window.clearTimeout(timer);
    // The version changes for every edit. Values are read from latestValues when saving.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editVersion, canEdit]);

  function markChanged() {
    latestVersion.current += 1;
    setEditVersion(latestVersion.current);
    setSavedNotice(false);
    onDirtyChange?.(true);
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
        <div onChangeCapture={markChanged} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rf-scope">Scope of work</Label>
            <Textarea id="rf-scope" value={scopeOfWork} onChange={(e) => setScopeOfWork(e.target.value)} rows={3} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rf-payment">Payment terms</Label>
              <Select id="rf-payment" value={customPayment ? "__custom__" : paymentTerms} onChange={(e) => {
                setCustomPayment(e.target.value === "__custom__");
                setPaymentTerms(e.target.value === "__custom__" ? "" : e.target.value);
              }}>
                <option value="">— Select payment terms —</option>
                {paymentTerms && !customPayment && !paymentOptions.includes(paymentTerms) && (
                  <option value={paymentTerms}>{paymentTerms}</option>
                )}
                {paymentOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                <option value="__custom__">Custom…</option>
              </Select>
              {customPayment && (
                <Input aria-label="Custom payment terms" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="Enter payment terms" />
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rf-warranty">Warranty</Label>
              <Input id="rf-warranty" type="date" value={isDateValue(warranty) ? warranty : ""} onChange={(e) => setWarranty(e.target.value)} />
              {warranty && !isDateValue(warranty) && <p className="text-xs text-muted-foreground">Previous wording: {warranty}. Choose a date to replace it.</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rf-leadtime">Lead time</Label>
              <Input id="rf-leadtime" type="date" value={isDateValue(leadTime) ? leadTime : ""} onChange={(e) => setLeadTime(e.target.value)} />
              {leadTime && !isDateValue(leadTime) && <p className="text-xs text-muted-foreground">Previous wording: {leadTime}. Choose a date to replace it.</p>}
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="rf-tc">Terms &amp; conditions</Label>
              {officialTemplate && <Button type="button" variant="outline" size="sm" onClick={() => setConfirmTemplate(true)}>Use official template</Button>}
            </div>
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
                Applies to new line items; each line can be changed separately. Enter the price before VAT. VAT Inclusive adds VAT to show the customer total; VAT Exempt adds no VAT.
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
          {submitting && <p role="status" className="text-sm text-muted-foreground">Saving changes…</p>}
          {savedNotice && !error && <p role="status" className="text-sm text-emerald-700">Changes saved.</p>}
          {error && <Button type="button" variant="outline" onClick={() => void saveChanges()}>Retry save</Button>}
        </div>
        <ActionConfirmDialog
          open={confirmTemplate}
          onOpenChange={setConfirmTemplate}
          title="Replace Terms & Conditions?"
          description="The current draft text will be replaced by the saved official template and saved automatically."
          reasonMode="none"
          confirmLabel="Use official template"
          submitting={false}
          error={null}
          onConfirm={() => { if (officialTemplate) { setTermsAndConditions(officialTemplate.body); markChanged(); } setConfirmTemplate(false); }}
        />
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
