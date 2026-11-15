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
import { SuggestedInput } from "@/components/quotations/suggested-input";
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
  const [sourceOther, setSourceOther] = useState(inquiry.sourceOther ?? "");
  const [tradeCode, setTradeCode] = useState(inquiry.tradeCode ?? "");
  const [tradeOther, setTradeOther] = useState(inquiry.tradeOther ?? "");
  const [inquiryTypeCode, setInquiryTypeCode] = useState(inquiry.inquiryTypeCode ?? (inquiry.inquiryTypeOther ? "__custom__" : ""));
  const [inquiryTypeOther, setInquiryTypeOther] = useState(inquiry.inquiryTypeOther ?? "");
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
        sourceOther: sourceCode === "OTHER" ? sourceOther.trim() : undefined,
        tradeCode: tradeCode || undefined,
        tradeOther: tradeCode === "OTHER" ? tradeOther.trim() : undefined,
        inquiryTypeCode: inquiryTypeCode === "__custom__" ? undefined : inquiryTypeCode || undefined,
        inquiryTypeOther: inquiryTypeCode === "__custom__" ? inquiryTypeOther.trim() : undefined,
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
                <SuggestedInput id="edit-inquiry-source" value={sourceCode === "OTHER" ? sourceOther : inquirySources.find((source) => source.code === sourceCode)?.label ?? ""} suggestions={inquirySources.filter((source) => source.code !== "OTHER").map((source) => source.label)} onChange={(e) => {
                  const text = e.target.value;
                  const source = inquirySources.find((item) => item.code !== "OTHER" && item.label.toLowerCase() === text.trim().toLowerCase());
                  setSourceCode(source?.code ?? (text.trim() ? "OTHER" : ""));
                  setSourceOther(source ? "" : text);
                }} placeholder="Select or type a source" maxLength={80} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-inquiry-trade">Trade (optional)</Label>
                <SuggestedInput id="edit-inquiry-trade" value={tradeCode === "OTHER" ? tradeOther : trades.find((trade) => trade.code === tradeCode)?.label ?? ""} suggestions={trades.filter((trade) => trade.code !== "OTHER").map((trade) => trade.label)} onChange={(e) => {
                  const text = e.target.value;
                  const trade = trades.find((item) => item.code !== "OTHER" && item.label.toLowerCase() === text.trim().toLowerCase());
                  setTradeCode(trade?.code ?? (text.trim() ? "OTHER" : ""));
                  setTradeOther(trade ? "" : text);
                }} placeholder="Select or type a trade" maxLength={80} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-inquiry-type">Type (optional)</Label>
                <SuggestedInput id="edit-inquiry-type" value={inquiryTypeCode === "__custom__" ? inquiryTypeOther : inquiryTypes.find((type) => type.code === inquiryTypeCode)?.label ?? ""} suggestions={inquiryTypes.map((type) => type.label)} onChange={(e) => {
                  const text = e.target.value;
                  const type = inquiryTypes.find((item) => item.label.toLowerCase() === text.trim().toLowerCase());
                  setInquiryTypeCode(type?.code ?? (text.trim() ? "__custom__" : ""));
                  setInquiryTypeOther(type ? "" : text);
                }} placeholder="Select or type an inquiry type" maxLength={80} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Inquiry number</Label><p className="rounded-md border px-3 py-2 text-sm">{inquiry.inquiryNumber}</p></div>
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
