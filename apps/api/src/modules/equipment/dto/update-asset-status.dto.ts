import { IsEnum } from "class-validator";
import { AssetStatus } from "@prisma/client";

export class UpdateAssetStatusDto {
  @IsEnum(AssetStatus)
  status!: AssetStatus;
}
