"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { createStandaloneWorkOrder, type Site, type StandaloneReasonType } from "@/lib/api";
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

const STANDALONE_REASON_TYPE_LABEL: Record<StandaloneReasonType, string> = {
  EMERGENCY: "Emergency",
  WARRANTY: "Warranty",
  CALLBACK: "Callback",
  INTERNAL: "Internal",
  OTHER: "Other",
};

// Path B (standalone, non-quotation) — POST /customers/:id/work-orders.
// standaloneReason and standaloneReasonType are both required by the
// backend DTO whenever there's no quotation to derive scope from (D10) —
// enforced here too, not just server-side, so the form can't submit
// without them.
export function CreateWorkOrderDialog({ customerId, sites, onCreated }: { customerId: string; sites: Site[]; onCreated: () => void }) {
  const router = useRouter();
  const { accessToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState("");
  const [standaloneReason, setStandaloneReason] = useState("");
  const [standaloneReasonType, setStandaloneReasonType] = useState<StandaloneReasonType>("INTERNAL");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setSiteId("");
    setStandaloneReason("");
    setStandaloneReasonType("INTERNAL");
    setEstimatedValue("");
    setScheduledDate("");
    setDescription("");
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!accessToken || !siteId || !standaloneReason) return;
    setSubmitting(true);
    setError(null);
    try {
      const workOrder = await createStandaloneWorkOrder(accessToken, customerId, {
        siteId,
        standaloneReason,
        standaloneReasonType,
        estimatedValue: estimatedValue ? Number(estimatedValue) : undefined,
        scheduledDate: scheduledDate || undefined,
        description: description || undefined,
      });
      setOpen(false);
      resetForm();
      onCreated();
      router.push(`/work-orders/${workOrder.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to create work order.");
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
        <Button>New Work Order</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New work order</DialogTitle>
            <DialogDescription>
              A standalone work order, not tied to any quotation. Scheduling and technician assignment happen next,
              on the work order&apos;s own page.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="wo-site">Site</Label>
              <Select id="wo-site" value={siteId} onChange={(e) => setSiteId(e.target.value)} required>
                <option value="" disabled>
                  Select a site…
                </option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="wo-reason-type">Reason</Label>
              <Select
                id="wo-reason-type"
                value={standaloneReasonType}
                onChange={(e) => setStandaloneReasonType(e.target.value as StandaloneReasonType)}
              >
                {Object.entries(STANDALONE_REASON_TYPE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="wo-reason">Reason details</Label>
              <Textarea
                id="wo-reason"
                value={standaloneReason}
                onChange={(e) => setStandaloneReason(e.target.value)}
                required
                rows={2}
                placeholder="Why this job exists, e.g. customer reported a no-cooling complaint"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="wo-estimated-value">Estimated value (optional)</Label>
                <Input
                  id="wo-estimated-value"
                  type="number"
                  min={0}
                  step="0.01"
                  value={estimatedValue}
                  onChange={(e) => setEstimatedValue(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wo-scheduled-date">Scheduled date (optional)</Label>
                <Input id="wo-scheduled-date" type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="wo-description">Description (optional)</Label>
              <Textarea id="wo-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter className="mt-6">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create work order"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
