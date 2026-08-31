import { IsString, MinLength } from "class-validator";

// Always requires its own explicit reason (§04) even when confirming a
// prior request — same "reason is restated at the point of action" pattern
// already used for Phase 3's rejectRevision/expireRevision.
export class CancelWorkOrderDto {
  @IsString()
  @MinLength(1)
  reason!: string;
}
