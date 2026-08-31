import { IsIn, IsOptional, IsString } from "class-validator";

// C6 — records the CUSTOMER's decision on a SENT revision, distinct from
// the internal REJECTED outcome (reject-revision.dto.ts). Deliberately
// IsIn(["ACCEPTED", "DECLINED"]) rather than @IsEnum(QuotationRevisionStatus)
// — this endpoint may only ever produce these two specific outcomes, not any
// of the other seven statuses in that enum. reason is optional for both
// ACCEPTED and DECLINED per C6 (the customer's stated reason may genuinely
// be unavailable).
export class RecordDecisionDto {
  @IsIn(["ACCEPTED", "DECLINED"])
  decision!: "ACCEPTED" | "DECLINED";

  @IsOptional()
  @IsString()
  reason?: string;
}
