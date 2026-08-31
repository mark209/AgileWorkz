import { IsNotEmpty, IsString } from "class-validator";

// C5 — manual expiry is not date-gated (validUntil need not have passed),
// so a mandatory reason is the compensating control: it's the only record
// of why staff decided this SENT revision is dead before its own deadline.
export class ExpireRevisionDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
