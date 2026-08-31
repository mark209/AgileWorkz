"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useReferenceData } from "@/lib/use-reference-data";
import { createQuotation, QUOTATION_TYPE_LABEL, type QuotationType, type Site } from "@/lib/api";
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
  const [primaryTradeCode, setPrimaryTradeCode] = useState("");
  const [customerReferenceNo, setCustomerReferenceNo] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setSiteId("");
    setQuotationType("REPAIR");
    setPrimaryTradeCode("");
    setCustomerReferenceNo("");
    setValidUntil("");
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!accessToken || !siteId || !primaryTradeCode) return;
    setSubmitting(true);
    setError(null);
    try {
      const quotation = await createQuotation(accessToken, customerId, {
        siteId,
        quotationType,
        primaryTradeCode,
        customerReferenceNo: customerReferenceNo || undefined,
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
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="create-qt-type">Quotation type</Label>
                <Select id="create-qt-type" value={quotationType} onChange={(e) => setQuotationType(e.target.value as QuotationType)}>
                  {Object.entries(QUOTATION_TYPE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-qt-trade">Primary trade</Label>
                <Select id="create-qt-trade" value={primaryTradeCode} onChange={(e) => setPrimaryTradeCode(e.target.value)} required>
                  <option value="" disabled>
                    Select a trade…
                  </option>
                  {trades.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="create-qt-ref">Customer reference no. (optional)</Label>
                <Input id="create-qt-ref" value={customerReferenceNo} onChange={(e) => setCustomerReferenceNo(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-qt-valid-until">Valid until (optional)</Label>
                <Input id="create-qt-valid-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter className="mt-6">
            <Button type="submit" disabled={submitting || !siteId || !primaryTradeCode}>
              {submitting ? "Creating…" : "Create quotation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
