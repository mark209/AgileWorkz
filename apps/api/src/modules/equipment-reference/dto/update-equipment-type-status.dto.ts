import { IsEnum } from "class-validator";
import { ReferenceStatus } from "@prisma/client";

export class UpdateEquipmentTypeStatusDto {
  @IsEnum(ReferenceStatus)
  status!: ReferenceStatus;
}
