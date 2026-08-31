import { IsInt, IsOptional, IsString, MinLength } from "class-validator";

export class CreateSectionDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  tradeCode?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
