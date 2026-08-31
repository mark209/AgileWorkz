import { IsEnum, IsOptional, IsString } from "class-validator";
import { ExtractionReviewStatus } from "@prisma/client";

// verifiedValue is required app-side only for CORRECTED (enforced in the
// service, not here, since it depends on another field's value — same
// precedent as UploadServiceReportDto.sourceType/workOrderId). For
// CONFIRMED/CONFIRMED_BLANK/NEEDS_FOLLOW_UP, any submitted verifiedValue is
// ignored — the server decides what verified_value becomes for those three
// statuses (see service-report-verification.service.ts).
export class SubmitFieldReviewDto {
  @IsEnum(ExtractionReviewStatus)
  reviewStatus!: ExtractionReviewStatus;

  @IsOptional()
  @IsString()
  verifiedValue?: string;
}
