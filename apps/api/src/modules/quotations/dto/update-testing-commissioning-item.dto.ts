import { IsBoolean, IsInt, IsOptional, IsString } from "class-validator";

export class UpdateTestingCommissioningItemDto {
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
