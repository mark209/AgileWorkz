import { IsString, MinLength } from "class-validator";

export class RequestCancelWorkOrderDto {
  @IsString()
  @MinLength(1)
  reason!: string;
}
