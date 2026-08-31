import { IsEnum, IsOptional, IsString, MinLength } from "class-validator";
import { ServiceReportSourceType } from "@prisma/client";

// The binary file itself arrives via @UploadedFile(), not this DTO — these
// are the multipart/form-data text fields sent alongside it. customerId is
// NOT a field here — it comes from the route param
// (POST /customers/:customerId/service-reports), matching
// CreateStandaloneWorkOrderDto's precedent for the same reason: one
// unambiguous source of truth for which customer, not a route param and a
// body field that could disagree.
//
// Only upload-time identifying fields are accepted here (siteId,
// workOrderId, reportTypeCode, sourceType, contactName/contactPhone) — every
// other Service Report field (serviceDate, technicians, measurements,
// problems, narrative, signoffs) is populated later, either by the
// extraction pipeline into staging tables or by the future Confirm
// transaction from verified staging values. Accepting them here would let a
// caller inject canonical-looking data that never went through OCR/AI
// staging or human verification at all.
export class UploadServiceReportDto {
  @IsString()
  @MinLength(1)
  siteId!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  workOrderId?: string;

  @IsString()
  @MinLength(1)
  reportTypeCode!: string;

  // Nullable at the schema level, but app-validated required when
  // workOrderId is absent (ServiceReport.sourceType's own doc comment:
  // "source_type records why the service happened when there's no Work
  // Order") — enforced in ServiceReportsService.upload, not here, since it
  // depends on another field's value.
  @IsOptional()
  @IsEnum(ServiceReportSourceType)
  sourceType?: ServiceReportSourceType;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;
}
