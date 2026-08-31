import { IsEnum } from "class-validator";
import { ReferenceStatus } from "@prisma/client";

export class UpdateCapacityUnitStatusDto {
  @IsEnum(ReferenceStatus)
  status!: ReferenceStatus;
}
