import { IsLatitude, IsLongitude, IsOptional, IsString } from "class-validator";

export class UpdateSiteDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  addressLine?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  postalCode?: string;

  @IsOptional()
  @IsLatitude()
  geoLat?: number;

  @IsOptional()
  @IsLongitude()
  geoLng?: number;

  @IsOptional()
  @IsString()
  primaryContactId?: string;

  @IsOptional()
  @IsString()
  accessNotes?: string;
}
