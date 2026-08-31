import { IsEnum, IsInt, Min } from "class-validator";
import { MaintenanceBillingFrequency, MaintenanceFrequency } from "@prisma/client";

export class UpdateMaintenanceDetailsDto {
  @IsInt()
  @Min(1)
  contractPeriodMonths!: number;

  @IsEnum(MaintenanceFrequency)
  frequency!: MaintenanceFrequency;

  @IsInt()
  @Min(1)
  scheduledVisits!: number;

  @IsEnum(MaintenanceBillingFrequency)
  billingFrequency!: MaintenanceBillingFrequency;
}
