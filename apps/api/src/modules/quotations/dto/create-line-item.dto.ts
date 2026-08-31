import { IsEnum, IsInt, IsNumber, IsOptional, IsPositive, IsString, MinLength } from "class-validator";
import { TaxTreatment } from "@prisma/client";

// unit_price_before_vat, unit_price, line_amount, and every discount/VAT-
// derived field are deliberately absent — 100% server-computed, per the
// approved "totals must never be trusted from client input" rule. Sending
// them is rejected outright (ValidationPipe whitelist), not silently
// ignored — same contract as CreateQuotationDto's missing vatRatePercent.
export class CreateLineItemDto {
  @IsString()
  @MinLength(1)
  description!: string;

  @IsOptional()
  @IsString()
  specification?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  model?: string;

  // C8: strictly positive — zero/negative quantities are rejected.
  @IsPositive()
  quantity!: number;

  @IsString()
  @MinLength(1)
  unit!: string;

  // Provide together with markupPercent for a costed line, or omit both and
  // supply unitPriceBeforeVat directly. If costing fields are present,
  // unit_price_before_vat is always server-computed and overwrites any
  // direct value also sent (§06a) — that is not an error, per the frozen
  // spec.
  @IsOptional()
  @IsNumber()
  unitCostExpense?: number;

  @IsOptional()
  @IsNumber()
  markupPercent?: number;

  @IsOptional()
  @IsNumber()
  unitPriceBeforeVat?: number;

  // Omit to inherit the revision's default_tax_treatment.
  @IsOptional()
  @IsEnum(TaxTreatment)
  taxTreatment?: TaxTreatment;

  @IsOptional()
  @IsNumber()
  materialAmount?: number;

  @IsOptional()
  @IsNumber()
  laborAmount?: number;

  @IsOptional()
  @IsString()
  sectionId?: string;

  @IsOptional()
  @IsString()
  assetId?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
