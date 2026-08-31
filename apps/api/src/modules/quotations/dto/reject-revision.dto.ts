import { IsNotEmpty, IsString } from "class-validator";

// C6 — REJECTED is the internal AgileWorks approval-workflow outcome
// (distinct from customer DECLINED, see record-decision.dto.ts). A reason
// is mandatory: this is a real internal business decision worth a mandatory
// paper trail, stored on audit_logs.reason.
export class RejectRevisionDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
