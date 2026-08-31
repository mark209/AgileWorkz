import { IsDateString, IsEnum, IsOptional, IsString, MinLength } from "class-validator";
import { QuotationType, TaxTreatment } from "@prisma/client";

// siteId and quotationType are always required explicitly — never silently
// inherited from the inquiry, per the approved conversion mapping.
// primaryTradeCode is optional and falls back to Inquiry.tradeCode; there is
// no such fallback for quotationType (inquiry_types has no approved
// suggestion-mapping to QuotationType yet — deferred, not assumed).
export class ConvertInquiryToQuotationDto {
  @IsString()
  @MinLength(1)
  siteId!: string;

  @IsEnum(QuotationType)
  quotationType!: QuotationType;

  @IsOptional()
  @IsString()
  primaryTradeCode?: string;

  // Overrides Inquiry.customerReferenceNo when provided; falls back to it
  // when omitted.
  @IsOptional()
  @IsString()
  customerReferenceNo?: string;

  // Overrides the inquiry's description/subject pre-fill when provided.
  @IsOptional()
  @IsString()
  scopeOfWork?: string;

  @IsOptional()
  @IsEnum(TaxTreatment)
  defaultTaxTreatment?: TaxTreatment;

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
  @IsDateString()
  validUntil?: string;
}
