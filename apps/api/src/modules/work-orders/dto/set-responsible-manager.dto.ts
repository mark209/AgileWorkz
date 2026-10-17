import { IsUUID, ValidateIf } from "class-validator";

export class SetResponsibleManagerDto {
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  responsibleManagerId!: string | null;
}
