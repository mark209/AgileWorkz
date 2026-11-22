import { IsBoolean, IsInt, IsOptional, IsString, MinLength } from "class-validator";

export class CreateTestingCommissioningItemDto {
  @IsOptional() @IsString()
  method?: string;

  @IsOptional() @IsString()
  indications?: string;

  @IsString()
  @MinLength(1)
  description!: string;

  @IsOptional()
  @IsBoolean()
  included?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
