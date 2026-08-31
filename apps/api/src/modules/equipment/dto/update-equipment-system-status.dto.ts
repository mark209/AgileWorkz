import { IsEnum } from "class-validator";
import { EquipmentSystemStatus } from "@prisma/client";

export class UpdateEquipmentSystemStatusDto {
  @IsEnum(EquipmentSystemStatus)
  status!: EquipmentSystemStatus;
}
