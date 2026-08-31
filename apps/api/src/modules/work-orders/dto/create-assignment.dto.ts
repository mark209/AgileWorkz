import { IsString, MinLength } from "class-validator";

export class CreateAssignmentDto {
  @IsString()
  @MinLength(1)
  technicianId!: string;
}
