import { ArrayMinSize, IsArray, IsDateString, IsOptional, IsString, MinLength } from "class-validator";

// §08 — "each dated by walking frequency forward from a chosen start date."
// The frozen plan puts the choice of start date at trigger time; nothing
// elsewhere in the schema (quotation_maintenance_details has no start-date
// column) supplies one automatically.
export class GenerateMaintenanceVisitsDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsDateString({ strict: true }, { each: true })
  visitDates?: string[];

  @IsOptional()
  @IsString()
  @MinLength(1)
  responsibleManagerId?: string;

  @IsDateString({ strict: true })
  startDate!: string;
}
