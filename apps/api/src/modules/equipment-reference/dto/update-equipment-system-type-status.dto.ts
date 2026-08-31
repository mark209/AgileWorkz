import { IsEnum } from "class-validator";
import { ReferenceStatus } from "@prisma/client";

export class UpdateEquipmentSystemTypeStatusDto {
  @IsEnum(ReferenceStatus)
  status!: ReferenceStatus;
}
