import { IsEnum } from "class-validator";
import { ReferenceStatus } from "@prisma/client";

export class UpdateInquirySourceStatusDto {
  @IsEnum(ReferenceStatus)
  status!: ReferenceStatus;
}
