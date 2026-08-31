import { IsInt, IsOptional, IsString } from "class-validator";

export class UpdateSectionDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  tradeCode?: string | null;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
