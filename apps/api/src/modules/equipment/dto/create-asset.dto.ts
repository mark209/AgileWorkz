import { IsDateString, IsNumber, IsOptional, IsString, MinLength } from "class-validator";

// parentAssetId / equipmentSystemId are settable at creation time (the
// initial link is just part of the asset_created snapshot). Re-linking an
// EXISTING asset goes through the dedicated PATCH /assets/:id/link endpoint
// instead, which has its own audit action (asset_regrouped) — see
// AssetsService.link().
export class CreateAssetDto {
  @IsOptional()
  @IsString()
  equipmentSystemId?: string;

  @IsOptional()
  @IsString()
  parentAssetId?: string;

  @IsString()
  @MinLength(1)
  assetTag!: string;

  @IsString()
  @MinLength(1)
  equipmentTypeCode!: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  modelNo?: string;

  @IsOptional()
  @IsString()
  serialNo?: string;

  // capacityValue and capacityUnitCode are required together, or not at all
  // (approved plan §03) — enforced in AssetsService, not here; it's a
  // cross-field rule, not a single-field shape rule.
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
