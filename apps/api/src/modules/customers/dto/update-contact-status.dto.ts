import { IsEnum } from "class-validator";
import { ContactStatus } from "@prisma/client";

export class UpdateContactStatusDto {
  @IsEnum(ContactStatus)
  status!: ContactStatus;
}
