import { IsBoolean, IsEnum, IsOptional, IsString, MinLength } from "class-validator";
import { QuotationType } from "@prisma/client";

export class CreateQuotationTermTemplateDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsEnum(QuotationType)
  quotationType?: QuotationType;

  @IsOptional()
  @IsString()
  tradeCode?: string;

  @IsString()
  @MinLength(1)
  body!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
