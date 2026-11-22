"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  MAINTENANCE_BILLING_FREQUENCY_LABEL,
  MAINTENANCE_FREQUENCY_LABEL,
  upsertMaintenanceDetails,
  completeMissingMaintenanceDetails,
  type MaintenanceBillingFrequency,
  type MaintenanceFrequency,
  type QuotationMaintenanceDetails,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Upsert-only (§07) — only ever populated for PREVENTIVE_MAINTENANCE
// quotations; the parent only renders this component for that type.
export function MaintenanceDetailsPanel({
  quotationId,
  revisionId,
  canEdit,
  details,
  onChanged,
  repairAccepted = false,
}: {
  quotationId: string;
  revisionId: string;
  canEdit: boolean;
  details: QuotationMaintenanceDetails | null;
  onChanged: () => void;
  repairAccepted?: boolean;
}) {
  const { accessToken } = useAuth();
  const [contractPeriodMonths, setContractPeriodMonths] = useState(String(details?.contractPeriodMonths ?? 12));
  const [frequency, setFrequency] = useState<MaintenanceFrequency>(details?.frequency ?? "QUARTERLY");
  const [scheduledVisits, setScheduledVisits] = useState(String(details?.scheduledVisits ?? 4));
  const [billingFrequency, setBillingFrequency] = useState<MaintenanceBillingFrequency>(details?.billingFrequency ?? "QUARTERLY");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    setSavedNotice(false);
    try {
      await (repairAccepted ? completeMissingMaintenanceDetails : upsertMaintenanceDetails)(accessToken, quotationId, revisionId, {
        contractPeriodMonths: Number(contractPeriodMonths),
        frequency,
        scheduledVisits: Number(scheduledVisits),
        billingFrequency,
      });
      setSavedNotice(true);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save maintenance details.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!canEdit && !details) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Maintenance visit plan</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 space-y-2 text-sm text-muted-foreground">
          <p>This section is only for quotations classified as Preventive Maintenance. It tells the system how many visit Work Orders to create and how far apart to date them. Repair, installation, supply and other quotation types do not need this plan.</p>
          <p>Example: a 12-month agreement, quarterly visits and 4 total visits creates four separate Work Orders. Billing frequency describes the agreement; generating visits does not create invoices or assign technicians.</p>
          <p>For a single maintenance visit, set Total visits to 1. For a job that is not a maintenance agreement, use its appropriate quotation type. Visits are generated only after quotation approval and customer acceptance.</p>
        </div>
        {repairAccepted && <p role="status" className="mb-3 text-sm text-amber-800">Complete the missing contract details to generate visits. This is recorded as an audited correction to the accepted quotation.</p>}
        {canEdit ? (
          <form onSubmit={handleSave} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="md-period">Contract period (months)</Label>
              <Input id="md-period" type="number" min="1" value={contractPeriodMonths} onChange={(e) => setContractPeriodMonths(e.target.value)} />
              <p className="text-xs text-muted-foreground">The length of the agreed maintenance coverage.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="md-frequency">Visit frequency</Label>
              <Select id="md-frequency" value={frequency} onChange={(e) => setFrequency(e.target.value as MaintenanceFrequency)}>
                {Object.entries(MAINTENANCE_FREQUENCY_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">How often the service visit takes place.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="md-visits">Total visits</Label>
              <Input id="md-visits" type="number" min="1" value={scheduledVisits} onChange={(e) => setScheduledVisits(e.target.value)} />
              <p className="text-xs text-muted-foreground">One Work Order will be created for each visit. Use 1 for a single visit.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="md-billing">Billing frequency</Label>
              <Select id="md-billing" value={billingFrequency} onChange={(e) => setBillingFrequency(e.target.value as MaintenanceBillingFrequency)}>
                {Object.entries(MAINTENANCE_BILLING_FREQUENCY_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">How often the customer is billed; this can differ from visit frequency.</p>
            </div>
            {error && <p className="col-span-full text-sm text-destructive">{error}</p>}
            {savedNotice && !error && <p className="col-span-full text-sm text-emerald-700">Saved.</p>}
            <div className="col-span-full">
              <Button type="submit" size="sm" disabled={submitting}>
                {submitting ? "Saving…" : "Save maintenance details"}
              </Button>
            </div>
          </form>
        ) : (
          details && (
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Contract period</dt>
                <dd className="text-sm">{details.contractPeriodMonths} months</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Visit frequency</dt>
                <dd className="text-sm">{MAINTENANCE_FREQUENCY_LABEL[details.frequency]}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Total visits</dt>
                <dd className="text-sm">{details.scheduledVisits}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Billing frequency</dt>
                <dd className="text-sm">{MAINTENANCE_BILLING_FREQUENCY_LABEL[details.billingFrequency]}</dd>
              </div>
            </dl>
          )
        )}
      </CardContent>
    </Card>
  );
}
