import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from "class-validator";

// phone/email "at least one required" is enforced in ContactsService, not
// here — it's a cross-field rule (either-or), not a single-field shape rule.
export class CreateContactDto {
  @IsString()
  @MinLength(1)
  fullName!: string;

  @IsOptional()
  @IsString()
  designation?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
