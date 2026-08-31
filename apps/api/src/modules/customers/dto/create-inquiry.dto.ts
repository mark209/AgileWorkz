import { IsDateString, IsOptional, IsString, MinLength } from "class-validator";

// No inquiryNumber here — it's system-generated (NumberingService), never
// client-supplied. See inquiries.service.ts.
export class CreateInquiryDto {
  @IsString()
  @MinLength(1)
  subject!: string;

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

  // The customer's requested/preferred date only — not a confirmed
  // schedule. See the field's schema.prisma comment.
  @IsOptional()
  @IsDateString()
  preferredServiceDate?: string;
}
