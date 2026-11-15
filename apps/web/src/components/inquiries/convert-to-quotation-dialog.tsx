"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useReferenceData } from "@/lib/use-reference-data";
import { convertInquiryToQuotation, listApprovedQuotationTypes, QUOTATION_TYPE_LABEL, type ApprovedQuotationType, type Inquiry, type QuotationType, type Site } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SuggestedInput } from "@/components/quotations/suggested-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// Delegates entirely to POST /inquiries/:id/quotations — the atomic
// OPEN -> CONVERTED flip plus Quotation/Revision 0 creation happens
// server-side (Step 5). This dialog only collects the inputs that endpoint
// requires; everything else (payment terms, warranty, T&C, ...) is
// editable afterward on the new Revision 0 in the quotation editor, kept
// out of this form on purpose so conversion stays a small, fast step.
export function ConvertToQuotationDialog({ inquiry, sites }: { inquiry: Inquiry; sites: Site[] }) {
  const router = useRouter();
  const { accessToken } = useAuth();
  const { trades } = useReferenceData();
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState(inquiry.siteId ?? "");
  const [quotationType, setQuotationType] = useState<QuotationType>("REPAIR");
  const [typeChoice, setTypeChoice] = useState("REPAIR");
  const [quotationTypeOther, setQuotationTypeOther] = useState("");
  const [primaryTradeCode, setPrimaryTradeCode] = useState(inquiry.tradeCode ?? "");
  const [primaryTradeOther, setPrimaryTradeOther] = useState(inquiry.tradeOther ?? "");
  const [approvedTypes, setApprovedTypes] = useState<ApprovedQuotationType[]>([]);
  const [validUntil, setValidUntil] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && accessToken) listApprovedQuotationTypes(accessToken).then(setApprovedTypes).catch(() => setApprovedTypes([]));
  }, [open, accessToken]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!accessToken || !siteId || !primaryTradeCode || (primaryTradeCode === "OTHER" && !primaryTradeOther.trim()) || (typeChoice === "__custom__" && !quotationTypeOther.trim())) return;
    setSubmitting(true);
    setError(null);
    try {
      const quotation = await convertInquiryToQuotation(accessToken, inquiry.id, {
        siteId,
        quotationType,
        quotationTypeOther: typeChoice === "__custom__" ? quotationTypeOther.trim() : typeChoice.startsWith("approved:") ? approvedTypes.find((item) => `approved:${item.id}` === typeChoice)?.label : undefined,
        primaryTradeCode: primaryTradeCode || undefined,
        primaryTradeOther: primaryTradeCode === "OTHER" ? primaryTradeOther.trim() : undefined,
        validUntil: validUntil || undefined,
      });
      setOpen(false);
      router.push(`/quotations/${quotation.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to convert this inquiry to a quotation.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Convert to Quotation</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Convert to quotation</DialogTitle>
            <DialogDescription>
              Creates a new quotation with Revision 0, and marks this inquiry as converted. Additional details can be
              filled in on the quotation afterward.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="convert-site">Site</Label>
              <Select id="convert-site" value={siteId} onChange={(e) => setSiteId(e.target.value)} required>
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
              {sites.length === 0 && <p className="text-xs text-muted-foreground">Add a site on this customer record before converting the inquiry.</p>}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="convert-type">Quotation type</Label>
                <SuggestedInput id="convert-type" value={typeChoice === "__custom__" ? quotationTypeOther : typeChoice.startsWith("approved:") ? approvedTypes.find((item) => `approved:${item.id}` === typeChoice)?.label ?? "" : QUOTATION_TYPE_LABEL[typeChoice as QuotationType] ?? ""} suggestions={[...Object.values(QUOTATION_TYPE_LABEL), ...approvedTypes.map((item) => item.label)]} onChange={(e) => {
                  const text = e.target.value;
                  const standard = Object.entries(QUOTATION_TYPE_LABEL).find(([, label]) => label.toLowerCase() === text.trim().toLowerCase());
                  const approved = approvedTypes.find((item) => item.label.toLowerCase() === text.trim().toLowerCase());
                  if (standard) { setTypeChoice(standard[0]); setQuotationType(standard[0] as QuotationType); setQuotationTypeOther(""); }
                  else if (approved) { setTypeChoice(`approved:${approved.id}`); if (approved.operationalType) setQuotationType(approved.operationalType); setQuotationTypeOther(""); }
                  else { setTypeChoice("__custom__"); setQuotationTypeOther(text); }
                }} placeholder="Select or type a quotation type" maxLength={80} required />
                {typeChoice === "__custom__" && quotationTypeOther.trim() && <div className="mt-2 space-y-2"><Label htmlFor="convert-operational-type">Operational type</Label><Select id="convert-operational-type" value={quotationType} onChange={(e) => setQuotationType(e.target.value as QuotationType)}>{Object.entries(QUOTATION_TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select><p className="text-xs text-muted-foreground">The typed label awaits Admin review. The operational type keeps existing Work Order rules.</p></div>}
                <p className="text-xs text-muted-foreground">Choose a suggestion or type directly in this field.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="convert-trade">Primary trade</Label>
                <SuggestedInput id="convert-trade" value={primaryTradeCode === "OTHER" ? primaryTradeOther : trades.find((trade) => trade.code === primaryTradeCode)?.label ?? ""} suggestions={trades.filter((trade) => trade.code !== "OTHER").map((trade) => trade.label)} onChange={(e) => {
                  const text = e.target.value;
                  const trade = trades.find((item) => item.code !== "OTHER" && item.label.toLowerCase() === text.trim().toLowerCase());
                  setPrimaryTradeCode(trade?.code ?? (text.trim() ? "OTHER" : ""));
                  setPrimaryTradeOther(trade ? "" : text);
                }} placeholder="Select or type a trade" maxLength={80} required />
                <p className="text-xs text-muted-foreground">Choose a suggestion or type a trade for Admin review.</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="convert-valid-until">Valid until (optional)</Label>
                <Input id="convert-valid-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter className="mt-6">
            <Button type="submit" disabled={submitting || !siteId || !primaryTradeCode || (primaryTradeCode === "OTHER" && !primaryTradeOther.trim()) || (typeChoice === "__custom__" && !quotationTypeOther.trim())}>
              {submitting ? "Converting…" : "Convert to quotation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
