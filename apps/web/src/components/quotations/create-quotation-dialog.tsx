"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useReferenceData } from "@/lib/use-reference-data";
import { createQuotation, listApprovedQuotationTypes, QUOTATION_TYPE_LABEL, type ApprovedQuotationType, type QuotationType, type Site } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SuggestedInput } from "./suggested-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// Direct creation (no inquiry) — POST /customers/:id/quotations. Kept to
// the same lean field set as ConvertToQuotationDialog: everything else
// (payment terms, warranty, T&C, scope) is editable on Revision 0
// immediately afterward in the quotation editor.
export function CreateQuotationDialog({ customerId, sites }: { customerId: string; sites: Site[] }) {
  const router = useRouter();
  const { accessToken } = useAuth();
  const { trades } = useReferenceData();
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState("");
  const [quotationType, setQuotationType] = useState<QuotationType>("REPAIR");
  const [typeChoice, setTypeChoice] = useState("REPAIR");
  const [quotationTypeOther, setQuotationTypeOther] = useState("");
  const [primaryTradeCode, setPrimaryTradeCode] = useState("");
  const [primaryTradeOther, setPrimaryTradeOther] = useState("");
  const [approvedTypes, setApprovedTypes] = useState<ApprovedQuotationType[]>([]);
  const [validUntil, setValidUntil] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && accessToken) listApprovedQuotationTypes(accessToken).then(setApprovedTypes).catch(() => setApprovedTypes([]));
  }, [open, accessToken]);

  function resetForm() {
    setSiteId("");
    setQuotationType("REPAIR");
    setTypeChoice("REPAIR");
    setQuotationTypeOther("");
    setPrimaryTradeCode("");
    setPrimaryTradeOther("");
    setValidUntil("");
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!accessToken || !siteId || !primaryTradeCode || (primaryTradeCode === "OTHER" && !primaryTradeOther.trim()) || (typeChoice === "__custom__" && !quotationTypeOther.trim())) return;
    setSubmitting(true);
    setError(null);
    try {
      const quotation = await createQuotation(accessToken, customerId, {
        siteId,
        quotationType,
        quotationTypeOther: typeChoice === "__custom__" ? quotationTypeOther.trim() : typeChoice.startsWith("approved:") ? approvedTypes.find((item) => `approved:${item.id}` === typeChoice)?.label : undefined,
        primaryTradeCode,
        primaryTradeOther: primaryTradeCode === "OTHER" ? primaryTradeOther.trim() : undefined,
        validUntil: validUntil || undefined,
      });
      setOpen(false);
      resetForm();
      router.push(`/quotations/${quotation.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to create quotation.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submitting && !next) return;
        setOpen(next);
        if (!next) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button>New Quotation</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New quotation</DialogTitle>
            <DialogDescription>
              Creates the quotation header and its Revision 0 in DRAFT. Sections, line items, and full details are
              added next in the editor.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="create-qt-site">Site</Label>
              <Select id="create-qt-site" value={siteId} onChange={(e) => setSiteId(e.target.value)} required>
                <option value="" disabled>
                  Select a site…
                </option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">Choose the service location for this quotation.</p>
              {sites.length === 0 && <p className="text-xs text-muted-foreground">Add a site on this customer record before creating a quotation.</p>}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="create-qt-type">Quotation type</Label>
                <SuggestedInput id="create-qt-type" value={typeChoice === "__custom__" ? quotationTypeOther : typeChoice.startsWith("approved:") ? approvedTypes.find((item) => `approved:${item.id}` === typeChoice)?.label ?? "" : QUOTATION_TYPE_LABEL[typeChoice as QuotationType] ?? ""} suggestions={[...Object.values(QUOTATION_TYPE_LABEL), ...approvedTypes.map((item) => item.label)]} onChange={(e) => {
                  const text = e.target.value;
                  const standard = Object.entries(QUOTATION_TYPE_LABEL).find(([, label]) => label.toLowerCase() === text.trim().toLowerCase());
                  const approved = approvedTypes.find((item) => item.label.toLowerCase() === text.trim().toLowerCase());
                  if (standard) { setTypeChoice(standard[0]); setQuotationType(standard[0] as QuotationType); setQuotationTypeOther(""); }
                  else if (approved) { setTypeChoice(`approved:${approved.id}`); if (approved.operationalType) setQuotationType(approved.operationalType); setQuotationTypeOther(""); }
                  else { setTypeChoice("__custom__"); setQuotationTypeOther(text); }
                }} placeholder="Select or type a quotation type" maxLength={80} required />
                {typeChoice === "__custom__" && quotationTypeOther.trim() && <div className="mt-2 space-y-2"><Label htmlFor="create-qt-operational-type">Operational type</Label><Select id="create-qt-operational-type" value={quotationType} onChange={(e) => setQuotationType(e.target.value as QuotationType)}>{Object.entries(QUOTATION_TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select><p className="text-xs text-muted-foreground">The typed label awaits Admin review. The operational type keeps existing Work Order rules.</p></div>}
                <p className="text-xs text-muted-foreground">Choose a suggestion or type directly in this field.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-qt-trade">Primary trade</Label>
                <SuggestedInput id="create-qt-trade" value={primaryTradeCode === "OTHER" ? primaryTradeOther : trades.find((trade) => trade.code === primaryTradeCode)?.label ?? ""} suggestions={trades.filter((trade) => trade.code !== "OTHER").map((trade) => trade.label)} onChange={(e) => {
                  const text = e.target.value;
                  const trade = trades.find((item) => item.code !== "OTHER" && item.label.toLowerCase() === text.trim().toLowerCase());
                  setPrimaryTradeCode(trade?.code ?? (text.trim() ? "OTHER" : ""));
                  setPrimaryTradeOther(trade ? "" : text);
                }} placeholder="Select or type a trade" maxLength={80} required />
                <p className="text-xs text-muted-foreground">Choose a suggestion or type a trade for Admin review.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="create-qt-valid-until">Valid until (optional)</Label>
                <Input id="create-qt-valid-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              </div>
            </div>

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" disabled={submitting} onClick={() => { setOpen(false); resetForm(); }}>Cancel</Button>
            <Button type="submit" disabled={submitting || !siteId || !primaryTradeCode || (primaryTradeCode === "OTHER" && !primaryTradeOther.trim()) || (typeChoice === "__custom__" && !quotationTypeOther.trim())}>
              {submitting ? "Creating…" : "Create quotation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
