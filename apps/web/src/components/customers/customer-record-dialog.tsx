"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { createContact, createSite, updateContact, updateCustomer, updateSite, type Contact, type Customer, type Site } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type Kind = "customer" | "site" | "contact";

export function CustomerRecordDialog({ kind, customer, record, onSaved }: { kind: Kind; customer: Customer; record?: Site | Contact; onSaved: () => void }) {
  const { accessToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(kind === "customer" ? customer.name : record ? "label" in record ? record.label : record.fullName : "");
  const [address, setAddress] = useState(kind === "customer" ? customer.billingAddress : record && "addressLine" in record ? record.addressLine : "");
  const [phone, setPhone] = useState(kind === "customer" ? customer.phone ?? "" : record && "phone" in record ? record.phone ?? "" : "");
  const [email, setEmail] = useState(kind === "customer" ? customer.email ?? "" : record && "email" in record ? record.email ?? "" : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = kind === "customer" ? "Edit customer" : `${record ? "Edit" : "Add"} ${kind}`;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === "customer") {
        await updateCustomer(accessToken, customer.id, { name: name.trim(), billingAddress: address.trim(), phone: phone.trim(), email: email.trim() || undefined });
      } else if (kind === "site") {
        const body = { label: name.trim(), addressLine: address.trim() };
        if (record) await updateSite(accessToken, record.id, body);
        else await createSite(accessToken, customer.id, body);
      } else {
        const body = { fullName: name.trim(), phone: phone.trim() || undefined, email: email.trim() || undefined };
        if (record) await updateContact(accessToken, record.id, body);
        else await createContact(accessToken, customer.id, body);
      }
      setOpen(false);
      if (kind !== "customer" && !record) { setName(""); setAddress(""); setPhone(""); setEmail(""); }
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save this record.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
      setOpen(next);
      setError(null);
      if (next) {
        setName(kind === "customer" ? customer.name : record ? "label" in record ? record.label : record.fullName : "");
        setAddress(kind === "customer" ? customer.billingAddress : record && "addressLine" in record ? record.addressLine : "");
        setPhone(kind === "customer" ? customer.phone ?? "" : record && "phone" in record ? record.phone ?? "" : "");
        setEmail(kind === "customer" ? customer.email ?? "" : record && "email" in record ? record.email ?? "" : "");
      }
    }}>
      <DialogTrigger asChild><Button variant="outline" size="sm">{title}</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={save}>
          <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>Keep customer and service location details accurate for future jobs.</DialogDescription></DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor={`${kind}-name`}>{kind === "site" ? "Site name" : kind === "contact" ? "Full name" : "Customer name"}</Label>
              <Input id={`${kind}-name`} value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            {kind !== "contact" && <div className="space-y-1.5">
              <Label htmlFor={`${kind}-address`}>{kind === "site" ? "Site address" : "Billing address"}</Label>
              <Textarea id={`${kind}-address`} value={address} onChange={(e) => setAddress(e.target.value)} required />
            </div>}
            {kind !== "site" && <>
              <div className="space-y-1.5"><Label htmlFor={`${kind}-phone`}>Phone</Label><Input id={`${kind}-phone`} value={phone} onChange={(e) => setPhone(e.target.value)} required={kind === "contact" && !email} /></div>
              <div className="space-y-1.5"><Label htmlFor={`${kind}-email`}>Email</Label><Input id={`${kind}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            </>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter className="mt-6"><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
