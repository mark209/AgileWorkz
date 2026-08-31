import { IsOptional, IsString, MinLength } from "class-validator";

export class CreateEquipmentSystemDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  systemTypeCode!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
