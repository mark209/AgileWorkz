import { IsDateString, IsEnum, IsIn, IsNumber, IsOptional, IsString, MaxLength } from "class-validator";
import { TaxTreatment } from "@prisma/client";

// vat_rate_percent is deliberately absent — never client-settable, always a
// live system_settings snapshot (Step 5, reaffirmed for Step 6 by C2/C4).
// discountPercent and discountAmount are mutually exclusive — sending both
// in the same request is rejected with 400 (C4); this is checked in the
// service layer, not declaratively, matching the existing "capacity pair"
// validation style used elsewhere in this codebase.
export class UpdateRevisionContentDto {
  @IsOptional() @IsIn(["AUTO", "STANDARD", "MAINTENANCE"])
  pdfLayout?: "AUTO" | "STANDARD" | "MAINTENANCE";

  @IsOptional() @IsString() @MaxLength(160)
  recipientName?: string;

  @IsOptional() @IsString() @MaxLength(160)
  preparedByName?: string;

  @IsOptional() @IsString()
  paymentInstructions?: string;

  @IsOptional() @IsString() @MaxLength(160)
  scopeChecklistTitle?: string;

  @IsOptional()
  @IsString()
  scopeOfWork?: string;

  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @IsOptional()
  @IsString()
  warranty?: string;

  @IsOptional()
  @IsString()
  leadTime?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  exclusions?: string;

  @IsOptional()
  @IsString()
  termsAndConditions?: string;

  @IsOptional()
  @IsDateString()
  validUntil?: string | null;

  @IsOptional()
  @IsEnum(TaxTreatment)
  defaultTaxTreatment?: TaxTreatment;

  @IsOptional()
  @IsNumber()
  discountPercent?: number;

  @IsOptional()
  @IsNumber()
  discountAmount?: number;
}
