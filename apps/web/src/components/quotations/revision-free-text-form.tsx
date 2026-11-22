"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { SAMPLE_BANK_INSTRUCTIONS } from "@/lib/quotation-samples";
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

function textUpdate(value: string, previousValue: string | null) {
  return value === (previousValue ?? "") ? undefined : value;
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
  hasTaxMismatch = false,
}: {
  quotationId: string;
  revisionId: string;
  canEdit: boolean;
  revision: QuotationRevision;
  onChanged: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  hasTaxMismatch?: boolean;
}) {
  const { accessToken } = useAuth();
  const [recipientName, setRecipientName] = useState(revision.recipientName ?? "");
  const [preparedByName, setPreparedByName] = useState(revision.preparedByName ?? "");
  const [paymentInstructions, setPaymentInstructions] = useState(revision.paymentInstructions ?? "");
  const [scopeChecklistTitle, setScopeChecklistTitle] = useState(revision.scopeChecklistTitle ?? "");
  const [pdfLayout, setPdfLayout] = useState<"AUTO" | "STANDARD" | "MAINTENANCE">(revision.pdfLayout ?? "AUTO");
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
    Number(revision.discountAmount) > 0 ? "amount" : "percent",
  );
  const [discountValue, setDiscountValue] = useState(
    Number(revision.discountAmount) > 0 ? revision.discountAmount : "0",
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
  const applyOverallTax = useRef(false);
  const savedDiscount = useRef({ mode: discountMode, value: discountValue });
  const fieldBaseline = useRef(revision);
  const initialPaymentTerms = useRef(revision.paymentTerms ?? "");

  useEffect(() => {
    const previous = fieldBaseline.current;
    if (previous.id === revision.id && previous.updatedAt && revision.updatedAt && new Date(revision.updatedAt).getTime() < new Date(previous.updatedAt).getTime()) return;
    const fields = [
      [setRecipientName, revision.recipientName, previous.recipientName],
      [setPreparedByName, revision.preparedByName, previous.preparedByName],
      [setPaymentInstructions, revision.paymentInstructions, previous.paymentInstructions],
      [setScopeChecklistTitle, revision.scopeChecklistTitle, previous.scopeChecklistTitle],
      [setScopeOfWork, revision.scopeOfWork, previous.scopeOfWork],
      [setPaymentTerms, revision.paymentTerms, previous.paymentTerms],
      [setWarranty, revision.warranty, previous.warranty],
      [setLeadTime, revision.leadTime, previous.leadTime],
      [setNotes, revision.notes, previous.notes],
      [setExclusions, revision.exclusions, previous.exclusions],
      [setTermsAndConditions, revision.termsAndConditions, previous.termsAndConditions],
    ] as const;
    for (const [setValue, next, before] of fields) setValue((value) => value === (before ?? "") ? next ?? "" : value);
    setPdfLayout((value) => value === (previous.pdfLayout ?? "AUTO") ? revision.pdfLayout ?? "AUTO" : value);
    setValidUntil((value) => value === (previous.validUntil?.slice(0, 10) ?? "") ? revision.validUntil?.slice(0, 10) ?? "" : value);
    setDefaultTaxTreatment((value) => value === previous.defaultTaxTreatment ? revision.defaultTaxTreatment : value);
    if (latestValues.current.discountMode === savedDiscount.current.mode && latestValues.current.discountValue === savedDiscount.current.value && revision.discountAmount !== previous.discountAmount) {
      const mode: DiscountMode = Number(revision.discountAmount) > 0 ? "amount" : "percent";
      const value = Number(revision.discountAmount) > 0 ? revision.discountAmount : "0";
      setDiscountMode(mode); setDiscountValue(value); savedDiscount.current = { mode, value };
      latestValues.current = { ...latestValues.current, discountMode: mode, discountValue: value };
    }
    fieldBaseline.current = revision;
  }, [revision]);

  const hasPlaceholder = termsAndConditions.includes("[PLACEHOLDER");

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    listPaymentTerms(accessToken).then((values) => {
      if (active) {
        setPaymentOptions(values);
        if (initialPaymentTerms.current && !values.includes(initialPaymentTerms.current)) setCustomPayment(true);
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

  const latestValues = useRef({ recipientName, preparedByName, paymentInstructions, scopeChecklistTitle, pdfLayout, scopeOfWork, paymentTerms, warranty, leadTime, notes, exclusions, termsAndConditions, validUntil, defaultTaxTreatment, discountMode, discountValue, revision });
  latestValues.current = { recipientName, preparedByName, paymentInstructions, scopeChecklistTitle, pdfLayout, scopeOfWork, paymentTerms, warranty, leadTime, notes, exclusions, termsAndConditions, validUntil, defaultTaxTreatment, discountMode, discountValue, revision };

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
        const discountChanged = value.discountMode !== savedDiscount.current.mode || value.discountValue !== savedDiscount.current.value;
        const saved = await updateRevisionContent(accessToken, quotationId, revisionId, {
          pdfLayout: value.pdfLayout === (fieldBaseline.current.pdfLayout ?? "AUTO") ? undefined : value.pdfLayout,
          recipientName: textUpdate(value.recipientName, fieldBaseline.current.recipientName ?? null),
          preparedByName: textUpdate(value.preparedByName, fieldBaseline.current.preparedByName ?? null),
          paymentInstructions: textUpdate(value.paymentInstructions, fieldBaseline.current.paymentInstructions ?? null),
          scopeChecklistTitle: textUpdate(value.scopeChecklistTitle, fieldBaseline.current.scopeChecklistTitle ?? null),
          scopeOfWork: textUpdate(value.scopeOfWork, fieldBaseline.current.scopeOfWork),
          paymentTerms: textUpdate(value.paymentTerms, fieldBaseline.current.paymentTerms),
          warranty: textUpdate(value.warranty, fieldBaseline.current.warranty),
          leadTime: textUpdate(value.leadTime, fieldBaseline.current.leadTime),
          notes: textUpdate(value.notes, fieldBaseline.current.notes),
          exclusions: textUpdate(value.exclusions, fieldBaseline.current.exclusions),
          termsAndConditions: textUpdate(value.termsAndConditions, fieldBaseline.current.termsAndConditions),
          validUntil: value.validUntil === (fieldBaseline.current.validUntil?.slice(0, 10) ?? "") ? undefined : value.validUntil || null,
          defaultTaxTreatment: !applyOverallTax.current && value.defaultTaxTreatment === fieldBaseline.current.defaultTaxTreatment ? undefined : value.defaultTaxTreatment,
          discountPercent: discountChanged && value.discountMode === "percent" ? Number(value.discountValue) : undefined,
          discountAmount: discountChanged && value.discountMode === "amount" ? Number(value.discountValue) : undefined,
        });
        const fields = [
          ["recipientName", setRecipientName, value.recipientName, saved.recipientName],
          ["preparedByName", setPreparedByName, value.preparedByName, saved.preparedByName],
          ["paymentInstructions", setPaymentInstructions, value.paymentInstructions, saved.paymentInstructions],
          ["scopeChecklistTitle", setScopeChecklistTitle, value.scopeChecklistTitle, saved.scopeChecklistTitle],
          ["scopeOfWork", setScopeOfWork, value.scopeOfWork, saved.scopeOfWork],
          ["paymentTerms", setPaymentTerms, value.paymentTerms, saved.paymentTerms],
          ["warranty", setWarranty, value.warranty, saved.warranty],
          ["leadTime", setLeadTime, value.leadTime, saved.leadTime],
          ["notes", setNotes, value.notes, saved.notes],
          ["exclusions", setExclusions, value.exclusions, saved.exclusions],
          ["termsAndConditions", setTermsAndConditions, value.termsAndConditions, saved.termsAndConditions],
        ] as const;
        for (const [key, setValue, submitted, persisted] of fields) {
          if (latestValues.current[key] === submitted) latestValues.current = { ...latestValues.current, [key]: persisted ?? "" };
          setValue((current) => current === submitted ? persisted ?? "" : current);
        }
        if (latestValues.current.validUntil === value.validUntil) {
          const persisted = saved.validUntil?.slice(0, 10) ?? "";
          latestValues.current = { ...latestValues.current, validUntil: persisted };
          setValidUntil((current) => current === value.validUntil ? persisted : current);
        }
        if (latestValues.current.defaultTaxTreatment === value.defaultTaxTreatment) {
          latestValues.current = { ...latestValues.current, defaultTaxTreatment: saved.defaultTaxTreatment };
          setDefaultTaxTreatment((current) => current === value.defaultTaxTreatment ? saved.defaultTaxTreatment : current);
        }
        if (latestValues.current.pdfLayout === value.pdfLayout) {
          const persisted = saved.pdfLayout ?? "AUTO";
          latestValues.current = { ...latestValues.current, pdfLayout: persisted };
          setPdfLayout((current) => current === value.pdfLayout ? persisted : current);
        }

        fieldBaseline.current = saved;
        if (latestVersion.current === version) applyOverallTax.current = false;
        savedDiscount.current = { mode: value.discountMode, value: value.discountValue };
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
          <ReadField label="Recipient / attention" value={revision.recipientName ?? null} />
          <ReadField label="Prepared by / from" value={revision.preparedByName ?? null} />
          <ReadField label="Mode of payment" value={revision.paymentInstructions ?? null} />
          <ReadField label="PDF table layout" value={revision.pdfLayout === "STANDARD" ? "Standard item table" : revision.pdfLayout === "MAINTENANCE" ? "Maintenance pricing table" : "Automatic"} />
          <ReadField label="Scope appendix title" value={revision.scopeChecklistTitle ?? null} />
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
          <ReadField label="Quotation tax treatment" value={TAX_TREATMENT_LABEL[revision.defaultTaxTreatment]} />
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="rf-recipient">Recipient / attention</Label><Input id="rf-recipient" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} maxLength={160} placeholder="Uses the saved customer contact when blank" /></div>
            <div className="space-y-1.5"><Label htmlFor="rf-prepared">Prepared by / from</Label><Input id="rf-prepared" value={preparedByName} onChange={(e) => setPreparedByName(e.target.value)} maxLength={160} placeholder="Uses the quotation creator when blank" /></div>
          </div>
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
              <Input id="rf-warranty" value={warranty} onChange={(e) => setWarranty(e.target.value)} placeholder="e.g. 2 weeks from completion, or a date" />

            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rf-leadtime">Lead time</Label>
              <Input id="rf-leadtime" value={leadTime} onChange={(e) => setLeadTime(e.target.value)} placeholder="e.g. 5 working days, or a date" />

            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rf-valid-until">Valid until</Label>
              <Input id="rf-valid-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2"><Label htmlFor="rf-payment-instructions">Mode of payment</Label><Button type="button" size="sm" variant="outline" onClick={() => { setPaymentInstructions(SAMPLE_BANK_INSTRUCTIONS); markChanged(); }}>Use sample bank details</Button></div>
            <Textarea id="rf-payment-instructions" rows={6} value={paymentInstructions} onChange={(e) => setPaymentInstructions(e.target.value)} />
            <p className="text-xs text-muted-foreground">Review the account details before sending. The PDF uses this saved text.</p>
          </div>
          <div className="space-y-1.5"><Label htmlFor="rf-pdf-layout">PDF table layout</Label><Select id="rf-pdf-layout" value={pdfLayout} onChange={(e) => setPdfLayout(e.target.value as "AUTO" | "STANDARD" | "MAINTENANCE")}><option value="AUTO">Automatic</option><option value="STANDARD">Standard item table (DataSpring sample)</option><option value="MAINTENANCE">Maintenance pricing table (Ford sample)</option></Select><p className="text-xs text-muted-foreground">Changes the table layout. Prices and tax treatment follow the saved line items.</p></div>
          <div className="space-y-1.5"><Label htmlFor="rf-scope-title">Scope appendix title</Label><Input id="rf-scope-title" value={scopeChecklistTitle} onChange={(e) => setScopeChecklistTitle(e.target.value)} maxLength={160} placeholder="Scope of work details" /><p className="text-xs text-muted-foreground">Included checklist items appear in the PDF appendix.</p></div>
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
              <Label htmlFor="rf-tax">Quotation tax treatment</Label>
              <Select id="rf-tax" value={defaultTaxTreatment} onChange={(e) => setDefaultTaxTreatment(e.target.value as TaxTreatment)}>
                {Object.entries(TAX_TREATMENT_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                Applies to all items in this quotation when saved. Enter selling prices before VAT. VAT Inclusive applies the saved VAT rate; VAT Exempt means no VAT is charged. The summary and PDF use the saved totals.
              </p>
              {hasTaxMismatch && <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900"><p>Some saved items still use a different tax setting. Apply the overall quotation tax to recalculate them.</p><Button type="button" size="sm" variant="outline" disabled={submitting} onClick={() => { applyOverallTax.current = true; markChanged(); }}>Apply quotation tax to all items</Button></div>}
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
