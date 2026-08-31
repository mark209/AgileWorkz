import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from "class-validator";
import { CustomerType } from "@prisma/client";

export class CreateCustomerDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEnum(CustomerType)
  customerType!: CustomerType;

  @IsString()
  @MinLength(1)
  billingAddress!: string;

  @IsOptional()
  @IsString()
  taxId?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  accountManagerId?: string;
}
