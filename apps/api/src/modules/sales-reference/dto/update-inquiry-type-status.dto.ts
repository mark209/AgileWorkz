import { IsEnum } from "class-validator";
import { ReferenceStatus } from "@prisma/client";

export class UpdateInquiryTypeStatusDto {
  @IsEnum(ReferenceStatus)
  status!: ReferenceStatus;
}
