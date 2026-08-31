"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { ReviewProgress } from "@/lib/service-report-field-status";
import { canCompleteVerification } from "@/lib/service-report-field-status";

export interface VerificationToolbarProps {
  progress: ReviewProgress;
  bulkEligibleCount: number | null;
  onLoadBulkPreview: () => Promise<void>;
  onBulkConfirm: () => Promise<void>;
  onComplete: () => Promise<void>;
  disabled: boolean;
}

export function VerificationToolbar({
  progress,
  bulkEligibleCount,
  onLoadBulkPreview,
  onBulkConfirm,
  onComplete,
  disabled,
}: VerificationToolbarProps) {
  const [bulkBusy, setBulkBusy] = useState(false);
  const [completeBusy, setCompleteBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const percent = progress.total === 0 ? 100 : Math.round((progress.reviewed / progress.total) * 100);
  const canComplete = !disabled && canCompleteVerification(progress);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <div>
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-foreground">
              Reviewed: {progress.reviewed} / {progress.total}
            </span>
            <span className="text-muted-foreground">
              Remaining: {progress.remaining}
              {progress.needsFollowUp > 0 && <span className="ml-3 text-destructive">Needs Follow-Up: {progress.needsFollowUp}</span>}
            </span>
          </div>
          <Progress value={percent} className="mt-2" />
        </div>

        {!disabled && (
          <div className="flex flex-wrap items-center gap-2">
            {bulkEligibleCount === null ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setError(null);
                  onLoadBulkPreview().catch((e) => setError(e instanceof Error ? e.message : "Failed to load preview."));
                }}
              >
                Preview bulk confirm
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={bulkBusy || bulkEligibleCount === 0}
                onClick={async () => {
                  setBulkBusy(true);
                  setError(null);
                  try {
                    await onBulkConfirm();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Bulk confirm failed.");
                  } finally {
                    setBulkBusy(false);
                  }
                }}
              >
                {bulkEligibleCount === 0 ? "No eligible fields to confirm" : `Confirm ${bulkEligibleCount} eligible field${bulkEligibleCount === 1 ? "" : "s"}`}
              </Button>
            )}

            <Button
              size="sm"
              variant="default"
              disabled={!canComplete || completeBusy}
              title={!canComplete ? "Every field must be reviewed, with no field left Needs Follow-Up, before completing verification" : undefined}
              onClick={async () => {
                setCompleteBusy(true);
                setError(null);
                try {
                  await onComplete();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Failed to complete verification.");
                } finally {
                  setCompleteBusy(false);
                }
              }}
            >
              Complete Verification
            </Button>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
