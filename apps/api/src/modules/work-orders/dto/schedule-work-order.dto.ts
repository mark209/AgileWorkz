import { IsDateString, IsOptional } from "class-validator";

// DRAFT -> SCHEDULED (§04). scheduledDate is optional here only because a
// Work Order may already have one set from creation/conversion (§03/§05);
// when omitted, the service falls back to whatever is already stored and
// rejects the transition if neither is present.
export class ScheduleWorkOrderDto {
  @IsOptional()
  @IsDateString()
  scheduledDate?: string;
}
