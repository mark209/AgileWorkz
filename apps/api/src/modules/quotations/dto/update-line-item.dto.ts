import { IsEnum, IsInt, IsNumber, IsOptional, IsPositive, IsString } from "class-validator";
import { TaxTreatment } from "@prisma/client";

export class UpdateLineItemDto {
  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  specification?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsPositive()
  quantity?: number;

  @IsOptional()
  @IsString()
  unit?: string;

  // Clearing costing back to a direct price is done by sending
  // unitCostExpense: null and markupPercent: null together with a new
  // unitPriceBeforeVat — see quotation-line-items.service.ts for the exact
  // merge-then-resolve rule applied on update.
  @IsOptional()
  @IsNumber()
  unitCostExpense?: number | null;

  @IsOptional()
  @IsNumber()
  markupPercent?: number | null;

  @IsOptional()
  @IsNumber()
  unitPriceBeforeVat?: number;

  @IsOptional()
  @IsEnum(TaxTreatment)
  taxTreatment?: TaxTreatment;

  @IsOptional()
  @IsNumber()
  materialAmount?: number | null;

  @IsOptional()
  @IsNumber()
  laborAmount?: number | null;

  @IsOptional()
  @IsString()
  sectionId?: string | null;

  @IsOptional()
  @IsString()
  assetId?: string | null;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
