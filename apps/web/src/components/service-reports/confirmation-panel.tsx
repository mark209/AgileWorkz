"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ConfirmationPlan } from "@/lib/api/service-report-confirmation";

export interface ConfirmationPanelProps {
  canConfirm: boolean;
  onLoadPreview: () => Promise<ConfirmationPlan>;
  onConfirm: () => Promise<void>;
}

/**
 * Phase 5 Step 6 (Confirm Report) — approved Decision 7. Shown on a VERIFIED
 * report: "Preview Confirm" runs the exact same deterministic mapping the
 * real Confirm will run, with ZERO persistent writes, so the reviewer can
 * see the OTHER_UNMAPPED / OTHER fallbacks and skipped (all-blank) groups
 * before committing. The preview payload is display-only — clicking
 * "Confirm Report" calls the real confirm endpoint, which independently
 * re-reads and re-validates from scratch (approved: never trust a
 * previously returned preview as authoritative input to Confirm).
 */
export function ConfirmationPanel({ canConfirm, onLoadPreview, onConfirm }: ConfirmationPanelProps) {
  const [plan, setPlan] = useState<ConfirmationPlan | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePreview() {
    setLoadingPreview(true);
    setError(null);
    try {
      setPlan(await onLoadPreview());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load Confirm preview.");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleConfirm() {
    setConfirming(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to confirm this report.");
    } finally {
      setConfirming(false);
    }
  }

  const otherUnmappedCount = plan?.measurements.filter((m) => m.measurementTypeResolution === "fallback_unmapped").length ?? 0;
  const otherEquipmentCount = plan?.equipmentUnits.filter((u) => u.equipmentTypeResolution === "fallback_other").length ?? 0;
  const otherSignoffCount = plan?.signoffs.filter((s) => s.signoffRoleResolution === "fallback_other").length ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Confirm Report</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          This report is Verified. Confirm writes the reviewed data into the official canonical Service Report record. This
          cannot be undone — Confirm is a forward-only step.
        </p>

        {!canConfirm && <p className="text-sm text-muted-foreground">You do not have permission to confirm Service Reports.</p>}

        {canConfirm && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={loadingPreview} onClick={handlePreview}>
              {plan ? "Refresh preview" : "Preview Confirm"}
            </Button>
            {plan && (
              <Button size="sm" disabled={!plan.isConfirmable || confirming} onClick={handleConfirm}>
                {confirming ? "Confirming…" : "Confirm Report"}
              </Button>
            )}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {plan && (
          <div className="flex flex-col gap-3 rounded-md border p-3 text-sm">
            {!plan.isConfirmable && (
              <div className="flex flex-col gap-1">
                {plan.validationIssues.map((issue) => (
                  <p key={issue.code} className="text-destructive">
                    {issue.message}
                  </p>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{plan.equipmentUnits.length} equipment unit(s)</Badge>
              <Badge variant="outline">{plan.problems.length} problem(s)</Badge>
              <Badge variant="outline">{plan.measurements.length} measurement(s)</Badge>
              <Badge variant="outline">{plan.narrativeItems.length} narrative item(s)</Badge>
              <Badge variant="outline">{plan.signoffs.length} signoff(s)</Badge>
              <Badge variant="outline">{plan.technicians.length} technician(s)</Badge>
              {plan.skipped.length > 0 && <Badge variant="neutral">{plan.skipped.length} skipped (all blank)</Badge>}
              {otherUnmappedCount > 0 && <Badge variant="warning">{otherUnmappedCount} measurement(s) → Other / Unmapped</Badge>}
              {otherEquipmentCount > 0 && <Badge variant="warning">{otherEquipmentCount} equipment unit(s) → Other</Badge>}
              {otherSignoffCount > 0 && <Badge variant="warning">{otherSignoffCount} signoff(s) → Other role</Badge>}
            </div>

            {plan.warnings.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="font-medium text-foreground">Warnings — review before confirming:</p>
                <ul className="list-inside list-disc text-muted-foreground">
                  {plan.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {plan.skipped.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="font-medium text-foreground">Skipped (entirely blank — no record will be created):</p>
                <ul className="list-inside list-disc text-muted-foreground">
                  {plan.skipped.map((s, i) => (
                    <li key={i}>
                      {s.category} (row {s.rowIndex}): {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
