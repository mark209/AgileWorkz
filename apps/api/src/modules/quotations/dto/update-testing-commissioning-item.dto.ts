import { IsBoolean, IsInt, IsOptional, IsString } from "class-validator";

export class UpdateTestingCommissioningItemDto {
  @IsOptional() @IsString()
  method?: string;

  @IsOptional() @IsString()
  indications?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  included?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
