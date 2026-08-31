import { IsEnum } from "class-validator";
import { SiteStatus } from "@prisma/client";

export class UpdateSiteStatusDto {
  @IsEnum(SiteStatus)
  status!: SiteStatus;
}
