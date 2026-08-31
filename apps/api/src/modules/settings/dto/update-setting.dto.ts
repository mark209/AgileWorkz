import { IsString, MinLength } from "class-validator";

export class UpdateSettingDto {
  @IsString()
  @MinLength(1)
  value!: string;
}
