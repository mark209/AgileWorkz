import { IsBoolean, IsInt, IsOptional, IsString, MinLength } from "class-validator";

export class CreateTestingCommissioningItemDto {
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
