import { IsDateString, IsEnum, IsOptional, IsString, MinLength } from "class-validator";
import { QuotationType, TaxTreatment } from "@prisma/client";

// No vatRatePercent field, deliberately — the VAT rate is always taken from
// the live system_settings.vat_rate_percent at creation and snapshotted
// onto Revision 0; an ordinary create request cannot override it (see
// quotations.service.ts). No terms_and_conditions field either — it is
// always server-derived from template selection (§08), never client-supplied
// at creation.
export class CreateQuotationDto {
  @IsString()
  @MinLength(1)
  siteId!: string;

  @IsEnum(QuotationType)
  quotationType!: QuotationType;

  @IsString()
  @MinLength(1)
  primaryTradeCode!: string;

  @IsOptional()
  @IsString()
  customerReferenceNo?: string;

  @IsOptional()
  @IsString()
  scopeOfWork?: string;

  // Omit to inherit the configured default_tax_treatment system setting.
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
