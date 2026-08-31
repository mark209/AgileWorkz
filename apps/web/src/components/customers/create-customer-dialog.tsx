"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { createCustomer, type Customer, type CustomerType, CUSTOMER_TYPE_LABEL } from "@/lib/api";
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

export function CreateCustomerDialog({ onCreated }: { onCreated: (customer: Customer) => void }) {
  const { accessToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [customerType, setCustomerType] = useState<CustomerType>("COMMERCIAL");
  const [billingAddress, setBillingAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setName("");
    setCustomerType("COMMERCIAL");
    setBillingAddress("");
    setPhone("");
    setEmail("");
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const customer = await createCustomer(accessToken, {
        name,
        customerType,
        billingAddress,
        phone: phone || undefined,
        email: email || undefined,
      });
      onCreated(customer);
      setOpen(false);
      resetForm();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to create customer.");
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
        <Button>New Customer</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New customer</DialogTitle>
            <DialogDescription>Create a customer record. Sites and contacts are added afterward.</DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="customer-name">Name</Label>
              <Input id="customer-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="customer-type">Customer type</Label>
              <Select
                id="customer-type"
                value={customerType}
                onChange={(e) => setCustomerType(e.target.value as CustomerType)}
              >
                {Object.entries(CUSTOMER_TYPE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="customer-address">Billing address</Label>
              <Textarea
                id="customer-address"
                value={billingAddress}
                onChange={(e) => setBillingAddress(e.target.value)}
                required
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="customer-phone">Phone (optional)</Label>
                <Input id="customer-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="customer-email">Email (optional)</Label>
                <Input id="customer-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter className="mt-6">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create customer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
