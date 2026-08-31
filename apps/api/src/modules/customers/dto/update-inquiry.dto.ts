import { IsDateString, IsOptional, IsString } from "class-validator";

export class UpdateInquiryDto {
  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  siteId?: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  sourceCode?: string;

  @IsOptional()
  @IsString()
  tradeCode?: string;

  @IsOptional()
  @IsString()
  inquiryTypeCode?: string;

  @IsOptional()
  @IsString()
  customerReferenceNo?: string;

  @IsOptional()
  @IsDateString()
  preferredServiceDate?: string;
}
