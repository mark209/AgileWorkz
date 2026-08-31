import { IsEnum } from "class-validator";
import { ReferenceStatus } from "@prisma/client";

export class UpdateQuotationTermTemplateStatusDto {
  @IsEnum(ReferenceStatus)
  status!: ReferenceStatus;
}
