import { IsOptional, IsString } from "class-validator";

// Tri-state per field, deliberately: omit the key to leave it unchanged,
// send an explicit `null` to clear the link, send a string id to set it.
// @IsOptional() makes class-validator skip all other validators when the
// value is null OR undefined, so `null` still passes @IsString() here and
// survives through to Prisma as an explicit "set this FK to null".
export class LinkAssetDto {
  @IsOptional()
  @IsString()
  parentAssetId?: string | null;

  @IsOptional()
  @IsString()
  equipmentSystemId?: string | null;
}
