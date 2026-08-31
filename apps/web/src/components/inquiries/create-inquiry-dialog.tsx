"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useReferenceData } from "@/lib/use-reference-data";
import { createInquiry, type Contact, type Inquiry, type Site } from "@/lib/api";
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
  DialogTrigger,
} from "@/components/ui/dialog";

export function CreateInquiryDialog({
  customerId,
  sites,
  contacts,
  onCreated,
}: {
  customerId: string;
  sites: Site[];
  contacts: Contact[];
  onCreated: (inquiry: Inquiry) => void;
}) {
  const { accessToken } = useAuth();
  const { trades, inquirySources, inquiryTypes } = useReferenceData();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [siteId, setSiteId] = useState("");
  const [contactId, setContactId] = useState("");
  const [sourceCode, setSourceCode] = useState("");
  const [tradeCode, setTradeCode] = useState("");
  const [inquiryTypeCode, setInquiryTypeCode] = useState("");
  const [customerReferenceNo, setCustomerReferenceNo] = useState("");
  const [preferredServiceDate, setPreferredServiceDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setSubject("");
    setDescription("");
    setSiteId("");
    setContactId("");
    setSourceCode("");
    setTradeCode("");
    setInquiryTypeCode("");
    setCustomerReferenceNo("");
    setPreferredServiceDate("");
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const inquiry = await createInquiry(accessToken, customerId, {
        subject,
        description: description || undefined,
        siteId: siteId || undefined,
        contactId: contactId || undefined,
        sourceCode: sourceCode || undefined,
        tradeCode: tradeCode || undefined,
        inquiryTypeCode: inquiryTypeCode || undefined,
        customerReferenceNo: customerReferenceNo || undefined,
        preferredServiceDate: preferredServiceDate || undefined,
      });
      onCreated(inquiry);
      setOpen(false);
      resetForm();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to create inquiry.");
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
        <Button>New Inquiry</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New inquiry</DialogTitle>
            <DialogDescription>
              Log a customer request. A quotation can be created directly from this inquiry once it&apos;s ready.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="inquiry-subject">Subject</Label>
              <Input id="inquiry-subject" value={subject} onChange={(e) => setSubject(e.target.value)} required />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="inquiry-description">Description (optional)</Label>
              <Textarea id="inquiry-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="inquiry-site">Site (optional)</Label>
                <Select id="inquiry-site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                  <option value="">— Not specified —</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inquiry-contact">Contact (optional)</Label>
                <Select id="inquiry-contact" value={contactId} onChange={(e) => setContactId(e.target.value)}>
                  <option value="">— Not specified —</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.fullName}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="inquiry-source">Source (optional)</Label>
                <Select id="inquiry-source" value={sourceCode} onChange={(e) => setSourceCode(e.target.value)}>
                  <option value="">—</option>
                  {inquirySources.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inquiry-trade">Trade (optional)</Label>
                <Select id="inquiry-trade" value={tradeCode} onChange={(e) => setTradeCode(e.target.value)}>
                  <option value="">—</option>
                  {trades.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inquiry-type">Type (optional)</Label>
                <Select id="inquiry-type" value={inquiryTypeCode} onChange={(e) => setInquiryTypeCode(e.target.value)}>
                  <option value="">—</option>
                  {inquiryTypes.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="inquiry-ref">Customer reference no. (optional)</Label>
                <Input id="inquiry-ref" value={customerReferenceNo} onChange={(e) => setCustomerReferenceNo(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inquiry-date">Preferred service date (optional)</Label>
                <Input
                  id="inquiry-date"
                  type="date"
                  value={preferredServiceDate}
                  onChange={(e) => setPreferredServiceDate(e.target.value)}
                />
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter className="mt-6">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create inquiry"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
