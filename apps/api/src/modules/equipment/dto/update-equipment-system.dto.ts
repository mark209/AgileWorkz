import { IsOptional, IsString } from "class-validator";

export class UpdateEquipmentSystemDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  systemTypeCode?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
