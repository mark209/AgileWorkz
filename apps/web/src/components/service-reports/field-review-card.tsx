"use client";

import { useState } from "react";
import { CheckCircle2, HelpCircle, Pencil, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ExtractionReviewStatus, StagedFieldView, StagingCategory } from "@/lib/api/service-report-verification";
import { getFieldDisplayStatus } from "@/lib/service-report-field-status";
import { FieldStatusBadge } from "./field-status-badge";

export interface FieldReviewCardProps {
  field: StagedFieldView;
  disabled: boolean;
  onSubmit: (
    category: StagingCategory,
    rowId: string,
    dto: { reviewStatus: ExtractionReviewStatus; verifiedValue?: string },
  ) => Promise<void>;
}

function formatAiValue(field: StagedFieldView): string {
  if (field.aiValue === null) return "(blank)";
  return field.aiUnit ? `${field.aiValue} ${field.aiUnit}` : field.aiValue;
}

export function FieldReviewCard({ field, disabled, onSubmit }: FieldReviewCardProps) {
  const [correcting, setCorrecting] = useState(false);
  const [draftValue, setDraftValue] = useState(field.aiValue ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = getFieldDisplayStatus(field);
  const alreadyReviewed = field.reviewStatus !== null;

  async function act(reviewStatus: ExtractionReviewStatus, verifiedValue?: string) {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(field.category, field.id, verifiedValue !== undefined ? { reviewStatus, verifiedValue } : { reviewStatus });
      setCorrecting(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save review decision.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-foreground">{field.fieldName}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            AI value: <span className="font-mono">{formatAiValue(field)}</span>
            {field.aiConfidence && <span className="ml-2 text-xs uppercase tracking-wide">confidence: {field.aiConfidence}</span>}
          </p>
          {field.stage && <p className="text-xs text-muted-foreground">Stage: {field.stage}</p>}
          {alreadyReviewed && (
            <p className="mt-1 text-sm">
              Verified value: <span className="font-mono">{field.verifiedValue ?? "(blank)"}</span>
            </p>
          )}
        </div>
        <FieldStatusBadge status={status} />
      </div>

      {!disabled && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!correcting ? (
            <>
              <Button size="sm" variant="outline" disabled={submitting} onClick={() => act("CONFIRMED")}>
                <CheckCircle2 className="h-3.5 w-3.5" /> Confirm
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={submitting}
                onClick={() => {
                  setDraftValue(field.aiValue ?? "");
                  setCorrecting(true);
                }}
              >
                <Pencil className="h-3.5 w-3.5" /> Correct
              </Button>
              <Button size="sm" variant="outline" disabled={submitting} onClick={() => act("CONFIRMED_BLANK")}>
                <XCircle className="h-3.5 w-3.5" /> Confirm Blank
              </Button>
              <Button size="sm" variant="outline" disabled={submitting} onClick={() => act("NEEDS_FOLLOW_UP")}>
                <HelpCircle className="h-3.5 w-3.5" /> Needs Follow-Up
              </Button>
            </>
          ) : (
            <div className="flex w-full items-center gap-2">
              <Input
                aria-label={`Corrected value for ${field.fieldName}`}
                value={draftValue}
                onChange={(e) => setDraftValue(e.target.value)}
                placeholder="Corrected value"
                className="h-8 max-w-xs"
                autoFocus
              />
              <Button size="sm" disabled={submitting} onClick={() => act("CORRECTED", draftValue)}>
                Save correction
              </Button>
              <Button size="sm" variant="ghost" disabled={submitting} onClick={() => setCorrecting(false)}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
