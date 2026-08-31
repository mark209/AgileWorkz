import { IsEnum } from "class-validator";
import { CustomerStatus } from "@prisma/client";

export class UpdateCustomerStatusDto {
  @IsEnum(CustomerStatus)
  status!: CustomerStatus;
}
