import { IsInt, IsOptional, IsString, Matches, MinLength } from "class-validator";

export class CreateInquirySourceDto {
  @IsString()
  @MinLength(1)
  @Matches(/^[A-Z0-9_]+$/, { message: "code must be uppercase letters, digits, and underscores only" })
  code!: string;

  @IsString()
  @MinLength(1)
  label!: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
