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
import { SuggestedInput } from "@/components/quotations/suggested-input";
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
  const [sourceOther, setSourceOther] = useState("");
  const [tradeCode, setTradeCode] = useState("");
  const [tradeOther, setTradeOther] = useState("");
  const [inquiryTypeCode, setInquiryTypeCode] = useState("");
  const [inquiryTypeOther, setInquiryTypeOther] = useState("");
  const [preferredServiceDate, setPreferredServiceDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setSubject("");
    setDescription("");
    setSiteId("");
    setContactId("");
    setSourceCode("");
    setSourceOther("");
    setTradeCode("");
    setTradeOther("");
    setInquiryTypeCode("");
    setInquiryTypeOther("");
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
        sourceOther: sourceCode === "OTHER" ? sourceOther.trim() : undefined,
        tradeCode: tradeCode || undefined,
        tradeOther: tradeCode === "OTHER" ? tradeOther.trim() : undefined,
        inquiryTypeCode: inquiryTypeCode === "__custom__" ? undefined : inquiryTypeCode || undefined,
        inquiryTypeOther: inquiryTypeCode === "__custom__" ? inquiryTypeOther.trim() : undefined,
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
                <SuggestedInput id="inquiry-source" value={sourceCode === "OTHER" ? sourceOther : inquirySources.find((source) => source.code === sourceCode)?.label ?? ""} suggestions={inquirySources.filter((source) => source.code !== "OTHER").map((source) => source.label)} onChange={(e) => {
                  const text = e.target.value;
                  const source = inquirySources.find((item) => item.code !== "OTHER" && item.label.toLowerCase() === text.trim().toLowerCase());
                  setSourceCode(source?.code ?? (text.trim() ? "OTHER" : ""));
                  setSourceOther(source ? "" : text);
                }} placeholder="Select or type a source" maxLength={80} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inquiry-trade">Trade (optional)</Label>
                <SuggestedInput id="inquiry-trade" value={tradeCode === "OTHER" ? tradeOther : trades.find((trade) => trade.code === tradeCode)?.label ?? ""} suggestions={trades.filter((trade) => trade.code !== "OTHER").map((trade) => trade.label)} onChange={(e) => {
                  const text = e.target.value;
                  const trade = trades.find((item) => item.code !== "OTHER" && item.label.toLowerCase() === text.trim().toLowerCase());
                  setTradeCode(trade?.code ?? (text.trim() ? "OTHER" : ""));
                  setTradeOther(trade ? "" : text);
                }} placeholder="Select or type a trade" maxLength={80} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inquiry-type">Type (optional)</Label>
                <SuggestedInput id="inquiry-type" value={inquiryTypeCode === "__custom__" ? inquiryTypeOther : inquiryTypes.find((type) => type.code === inquiryTypeCode)?.label ?? ""} suggestions={inquiryTypes.map((type) => type.label)} onChange={(e) => {
                  const text = e.target.value;
                  const type = inquiryTypes.find((item) => item.label.toLowerCase() === text.trim().toLowerCase());
                  setInquiryTypeCode(type?.code ?? (text.trim() ? "__custom__" : ""));
                  setInquiryTypeOther(type ? "" : text);
                }} placeholder="Select or type an inquiry type" maxLength={80} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
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
