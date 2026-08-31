import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, Min, MinLength } from "class-validator";
import { StandaloneReasonType } from "@prisma/client";

// Path B (approved plan §02/§03) — no quotationId/quotationRevisionId field
// exists here at all, not just left optional: a STANDALONE Work Order has no
// quotation to link to, full stop. standaloneReason and standaloneReasonType
// (D10) are both required, not conditional, because this DTO is only ever
// used for the standalone path — the FROM_QUOTATION path never touches it.
export class CreateStandaloneWorkOrderDto {
  @IsString()
  @MinLength(1)
  siteId!: string;

  @IsString()
  @MinLength(1)
  standaloneReason!: string;

  @IsEnum(StandaloneReasonType)
  standaloneReasonType!: StandaloneReasonType;

  // D10 extension point — an optional rough estimate for a job with no
  // quotation to read a real figure from. No threshold logic reads it yet.
  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedValue?: number;

  // Optional at creation (§05: "a Work Order can sit in DRAFT while
  // scheduling is worked out") — required only to reach SCHEDULED, a Step 5
  // transition not built yet.
  @IsOptional()
  @IsDateString()
  scheduledDate?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
