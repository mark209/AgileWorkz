"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useReferenceData } from "@/lib/use-reference-data";
import { convertInquiryToQuotation, QUOTATION_TYPE_LABEL, type Inquiry, type QuotationType, type Site } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
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
  const [primaryTradeCode, setPrimaryTradeCode] = useState(inquiry.tradeCode ?? "");
  const [customerReferenceNo, setCustomerReferenceNo] = useState(inquiry.customerReferenceNo ?? "");
  const [validUntil, setValidUntil] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!accessToken || !siteId) return;
    setSubmitting(true);
    setError(null);
    try {
      const quotation = await convertInquiryToQuotation(accessToken, inquiry.id, {
        siteId,
        quotationType,
        primaryTradeCode: primaryTradeCode || undefined,
        customerReferenceNo: customerReferenceNo || undefined,
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
                <Select id="convert-type" value={quotationType} onChange={(e) => setQuotationType(e.target.value as QuotationType)}>
                  {Object.entries(QUOTATION_TYPE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-muted-foreground">Select the work this quotation covers.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="convert-trade">Primary trade</Label>
                <Select id="convert-trade" value={primaryTradeCode} onChange={(e) => setPrimaryTradeCode(e.target.value)} required>
                  <option value="" disabled>
                    Select a trade…
                  </option>
                  {trades.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.label}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-muted-foreground">Choose the main trade for the work.</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="convert-ref">Customer reference no. (optional)</Label>
                <Input id="convert-ref" value={customerReferenceNo} onChange={(e) => setCustomerReferenceNo(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="convert-valid-until">Valid until (optional)</Label>
                <Input id="convert-valid-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter className="mt-6">
            <Button type="submit" disabled={submitting || !siteId || !primaryTradeCode}>
              {submitting ? "Converting…" : "Convert to quotation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
