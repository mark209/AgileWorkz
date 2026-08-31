import { IsDateString, IsOptional } from "class-validator";

// Path A (approved plan §02/§05). Everything else about the resulting Work
// Order(s) — customer/site, scope by reference, costing snapshot, copied
// checklist — is server-derived from the ACCEPTED revision itself; the only
// thing conversion accepts from the caller is this one optional field,
// applied identically to every Work Order the conversion produces.
export class ConvertToWorkOrdersDto {
  @IsOptional()
  @IsDateString()
  scheduledDate?: string;
}
