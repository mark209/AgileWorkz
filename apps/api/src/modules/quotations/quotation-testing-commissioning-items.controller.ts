import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { QuotationsService } from "./quotations.service";
import { QuotationTestingCommissioningItemsService } from "./quotation-testing-commissioning-items.service";
import { CreateTestingCommissioningItemDto } from "./dto/create-testing-commissioning-item.dto";
import { UpdateTestingCommissioningItemDto } from "./dto/update-testing-commissioning-item.dto";
import { Permissions } from "../../common/guards/permissions.decorator";

interface AuthedRequest extends Request {
  user: { userId: string };
}

function actorFrom(req: AuthedRequest) {
  return { userId: req.user.userId, ipAddress: req.ip, userAgent: req.get("user-agent") ?? undefined };
}

@Controller("quotations/:quotationId/revisions/:revisionId/testing-commissioning-items")
export class QuotationTestingCommissioningItemsController {
  constructor(
    private readonly quotationsService: QuotationsService,
    private readonly itemsService: QuotationTestingCommissioningItemsService,
  ) {}

  @Permissions({ module: "quotations", action: "read" })
  @Get()
  async list(@Param("quotationId") quotationId: string, @Param("revisionId") revisionId: string) {
    await this.quotationsService.findRevisionOrThrow(quotationId, revisionId);
    return this.itemsService.list(revisionId);
  }

  @Permissions({ module: "quotations", action: "update" })
  @Post()
  async create(
    @Param("quotationId") quotationId: string,
    @Param("revisionId") revisionId: string,
    @Body() dto: CreateTestingCommissioningItemDto,
    @Req() req: AuthedRequest,
  ) {
    await this.quotationsService.findRevisionOrThrow(quotationId, revisionId);
    return this.itemsService.create(revisionId, dto, actorFrom(req));
  }

  @Permissions({ module: "quotations", action: "update" })
  @Patch(":itemId")
  async update(
    @Param("quotationId") quotationId: string,
    @Param("revisionId") revisionId: string,
    @Param("itemId") itemId: string,
    @Body() dto: UpdateTestingCommissioningItemDto,
    @Req() req: AuthedRequest,
  ) {
    await this.quotationsService.findRevisionOrThrow(quotationId, revisionId);
    return this.itemsService.update(revisionId, itemId, dto, actorFrom(req));
  }

  @Permissions({ module: "quotations", action: "update" })
  @Delete(":itemId")
  async remove(
    @Param("quotationId") quotationId: string,
    @Param("revisionId") revisionId: string,
    @Param("itemId") itemId: string,
    @Req() req: AuthedRequest,
  ) {
    await this.quotationsService.findRevisionOrThrow(quotationId, revisionId);
    await this.itemsService.remove(revisionId, itemId, actorFrom(req));
    return { success: true };
  }
}
