import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { QuotationTermTemplatesService } from "./quotation-term-templates.service";
import { CreateQuotationTermTemplateDto } from "./dto/create-quotation-term-template.dto";
import { UpdateQuotationTermTemplateStatusDto } from "./dto/update-quotation-term-template-status.dto";
import { Permissions } from "../../common/guards/permissions.decorator";

interface AuthedRequest extends Request {
  user: { userId: string };
}

function actorFrom(req: AuthedRequest) {
  return { userId: req.user.userId, ipAddress: req.ip, userAgent: req.get("user-agent") ?? undefined };
}

@Controller("quotation-templates")
export class QuotationTermTemplatesController {
  constructor(private readonly templatesService: QuotationTermTemplatesService) {}

  @Permissions({ module: "quotation_templates", action: "read" })
  @Get()
  async list() {
    return this.templatesService.list();
  }

  @Permissions({ module: "quotation_templates", action: "manage" })
  @Post()
  async create(@Body() dto: CreateQuotationTermTemplateDto, @Req() req: AuthedRequest) {
    return this.templatesService.create(dto, actorFrom(req));
  }

  @Permissions({ module: "quotation_templates", action: "manage" })
  @Patch(":id/status")
  async updateStatus(
    @Param("id") id: string,
    @Body() dto: UpdateQuotationTermTemplateStatusDto,
    @Req() req: AuthedRequest,
  ) {
    return this.templatesService.updateStatus(id, dto.status, actorFrom(req));
  }
}
