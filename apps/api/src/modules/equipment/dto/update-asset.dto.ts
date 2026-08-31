import { IsDateString, IsNumber, IsOptional, IsString } from "class-validator";

// Deliberately excludes parentAssetId / equipmentSystemId — those are only
// changeable through PATCH /assets/:id/link (see LinkAssetDto), which has
// its own audit action. Also excludes siteId: assets don't move between
// sites in V1, same as sites not moving between customers.
export class UpdateAssetDto {
  @IsOptional()
  @IsString()
  assetTag?: string;

  @IsOptional()
  @IsString()
  equipmentTypeCode?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  modelNo?: string;

  @IsOptional()
  @IsString()
  serialNo?: string;

  @IsOptional()
  @IsNumber()
  capacityValue?: number;

  @IsOptional()
  @IsString()
  capacityUnitCode?: string;

  @IsOptional()
  @IsString()
  refrigerantType?: string;

  @IsOptional()
  @IsString()
  locationInSite?: string;

  @IsOptional()
  @IsDateString()
  installDate?: string;

  @IsOptional()
  @IsDateString()
  warrantyExpiry?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
