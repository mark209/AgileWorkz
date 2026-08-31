import { IsEnum } from "class-validator";
import { ReferenceStatus } from "@prisma/client";

export class UpdateTradeStatusDto {
  @IsEnum(ReferenceStatus)
  status!: ReferenceStatus;
}
