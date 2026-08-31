import { Body, Controller, Get, Param, Patch, Req } from "@nestjs/common";
import { Request } from "express";
import { QuotationsService } from "./quotations.service";
import { QuotationMaintenanceDetailsService } from "./quotation-maintenance-details.service";
import { UpdateMaintenanceDetailsDto } from "./dto/update-maintenance-details.dto";
import { Permissions } from "../../common/guards/permissions.decorator";

interface AuthedRequest extends Request {
  user: { userId: string };
}

function actorFrom(req: AuthedRequest) {
  return { userId: req.user.userId, ipAddress: req.ip, userAgent: req.get("user-agent") ?? undefined };
}

@Controller("quotations/:quotationId/revisions/:revisionId/maintenance-details")
export class QuotationMaintenanceDetailsController {
  constructor(
    private readonly quotationsService: QuotationsService,
    private readonly maintenanceDetailsService: QuotationMaintenanceDetailsService,
  ) {}

  @Permissions({ module: "quotations", action: "read" })
  @Get()
  async get(@Param("quotationId") quotationId: string, @Param("revisionId") revisionId: string) {
    await this.quotationsService.findRevisionOrThrow(quotationId, revisionId);
    return this.maintenanceDetailsService.get(revisionId);
  }

  @Permissions({ module: "quotations", action: "update" })
  @Patch()
  async upsert(
    @Param("quotationId") quotationId: string,
    @Param("revisionId") revisionId: string,
    @Body() dto: UpdateMaintenanceDetailsDto,
    @Req() req: AuthedRequest,
  ) {
    await this.quotationsService.findRevisionOrThrow(quotationId, revisionId);
    return this.maintenanceDetailsService.upsert(revisionId, dto, actorFrom(req));
  }
}
