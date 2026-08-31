import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { QuotationsService } from "./quotations.service";
import { QuotationLineItemsService } from "./quotation-line-items.service";
import { CreateLineItemDto } from "./dto/create-line-item.dto";
import { UpdateLineItemDto } from "./dto/update-line-item.dto";
import { Permissions } from "../../common/guards/permissions.decorator";

interface AuthedRequest extends Request {
  user: { userId: string };
}

function actorFrom(req: AuthedRequest) {
  return { userId: req.user.userId, ipAddress: req.ip, userAgent: req.get("user-agent") ?? undefined };
}

@Controller("quotations/:quotationId/revisions/:revisionId/line-items")
export class QuotationLineItemsController {
  constructor(
    private readonly quotationsService: QuotationsService,
    private readonly lineItemsService: QuotationLineItemsService,
  ) {}

  @Permissions({ module: "quotations", action: "read" })
  @Get()
  async list(@Param("quotationId") quotationId: string, @Param("revisionId") revisionId: string) {
    await this.quotationsService.findRevisionOrThrow(quotationId, revisionId);
    return this.lineItemsService.list(revisionId);
  }

  @Permissions({ module: "quotations", action: "update" })
  @Post()
  async create(
    @Param("quotationId") quotationId: string,
    @Param("revisionId") revisionId: string,
    @Body() dto: CreateLineItemDto,
    @Req() req: AuthedRequest,
  ) {
    await this.quotationsService.findRevisionOrThrow(quotationId, revisionId);
    return this.lineItemsService.create(revisionId, dto, actorFrom(req));
  }

  @Permissions({ module: "quotations", action: "update" })
  @Patch(":lineItemId")
  async update(
    @Param("quotationId") quotationId: string,
    @Param("revisionId") revisionId: string,
    @Param("lineItemId") lineItemId: string,
    @Body() dto: UpdateLineItemDto,
    @Req() req: AuthedRequest,
  ) {
    await this.quotationsService.findRevisionOrThrow(quotationId, revisionId);
    return this.lineItemsService.update(revisionId, lineItemId, dto, actorFrom(req));
  }

  @Permissions({ module: "quotations", action: "update" })
  @Delete(":lineItemId")
  async remove(
    @Param("quotationId") quotationId: string,
    @Param("revisionId") revisionId: string,
    @Param("lineItemId") lineItemId: string,
    @Req() req: AuthedRequest,
  ) {
    await this.quotationsService.findRevisionOrThrow(quotationId, revisionId);
    await this.lineItemsService.remove(revisionId, lineItemId, actorFrom(req));
    return { success: true };
  }
}
