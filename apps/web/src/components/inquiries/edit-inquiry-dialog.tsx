"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useReferenceData } from "@/lib/use-reference-data";
import { updateInquiry, type Contact, type Inquiry, type Site } from "@/lib/api";
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

export function EditInquiryDialog({
  inquiry,
  sites,
  contacts,
  open,
  onOpenChange,
  onUpdated,
}: {
  inquiry: Inquiry;
  sites: Site[];
  contacts: Contact[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: (inquiry: Inquiry) => void;
}) {
  const { accessToken } = useAuth();
  const { trades, inquirySources, inquiryTypes } = useReferenceData();
  const [subject, setSubject] = useState(inquiry.subject);
  const [description, setDescription] = useState(inquiry.description ?? "");
  const [siteId, setSiteId] = useState(inquiry.siteId ?? "");
  const [contactId, setContactId] = useState(inquiry.contactId ?? "");
  const [sourceCode, setSourceCode] = useState(inquiry.sourceCode ?? "");
  const [tradeCode, setTradeCode] = useState(inquiry.tradeCode ?? "");
  const [inquiryTypeCode, setInquiryTypeCode] = useState(inquiry.inquiryTypeCode ?? "");
  const [customerReferenceNo, setCustomerReferenceNo] = useState(inquiry.customerReferenceNo ?? "");
  const [preferredServiceDate, setPreferredServiceDate] = useState(inquiry.preferredServiceDate?.slice(0, 10) ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await updateInquiry(accessToken, inquiry.id, {
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
      onUpdated(updated);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to update inquiry.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit inquiry</DialogTitle>
            <DialogDescription>{inquiry.inquiryNumber}</DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-inquiry-subject">Subject</Label>
              <Input id="edit-inquiry-subject" value={subject} onChange={(e) => setSubject(e.target.value)} required />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-inquiry-description">Description (optional)</Label>
              <Textarea id="edit-inquiry-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-inquiry-site">Site (optional)</Label>
                <Select id="edit-inquiry-site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                  <option value="">— Not specified —</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-inquiry-contact">Contact (optional)</Label>
                <Select id="edit-inquiry-contact" value={contactId} onChange={(e) => setContactId(e.target.value)}>
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
                <Label htmlFor="edit-inquiry-source">Source (optional)</Label>
                <Select id="edit-inquiry-source" value={sourceCode} onChange={(e) => setSourceCode(e.target.value)}>
                  <option value="">—</option>
                  {inquirySources.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-inquiry-trade">Trade (optional)</Label>
                <Select id="edit-inquiry-trade" value={tradeCode} onChange={(e) => setTradeCode(e.target.value)}>
                  <option value="">—</option>
                  {trades.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-inquiry-type">Type (optional)</Label>
                <Select id="edit-inquiry-type" value={inquiryTypeCode} onChange={(e) => setInquiryTypeCode(e.target.value)}>
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
                <Label htmlFor="edit-inquiry-ref">Customer reference no. (optional)</Label>
                <Input id="edit-inquiry-ref" value={customerReferenceNo} onChange={(e) => setCustomerReferenceNo(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-inquiry-date">Preferred service date (optional)</Label>
                <Input
                  id="edit-inquiry-date"
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
              {submitting ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
