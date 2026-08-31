"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ExtractionReviewStatus, StagedFieldView, StagingCategory } from "@/lib/api/service-report-verification";
import { sortByAttention } from "@/lib/service-report-field-status";
import { FieldReviewCard } from "./field-review-card";

export interface FieldSectionProps {
  category: StagingCategory;
  label: string;
  fields: StagedFieldView[];
  disabled: boolean;
  onSubmit: (
    category: StagingCategory,
    rowId: string,
    dto: { reviewStatus: ExtractionReviewStatus; verifiedValue?: string },
  ) => Promise<void>;
}

export function FieldSection({ category, label, fields, disabled, onSubmit }: FieldSectionProps) {
  if (fields.length === 0) return null;
  const sorted = sortByAttention(fields);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {label} <span className="font-normal text-muted-foreground">({fields.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {sorted.map((field) => (
          <FieldReviewCard key={field.id} field={field} disabled={disabled} onSubmit={onSubmit} />
        ))}
      </CardContent>
    </Card>
  );
}
