import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { InquirySourcesService } from "./inquiry-sources.service";
import { CreateInquirySourceDto } from "./dto/create-inquiry-source.dto";
import { UpdateInquirySourceStatusDto } from "./dto/update-inquiry-source-status.dto";
import { Permissions } from "../../common/guards/permissions.decorator";

interface AuthedRequest extends Request {
  user: { userId: string };
}

function actorFrom(req: AuthedRequest) {
  return { userId: req.user.userId, ipAddress: req.ip, userAgent: req.get("user-agent") ?? undefined };
}

@Controller("inquiry-sources")
export class InquirySourcesController {
  constructor(private readonly inquirySourcesService: InquirySourcesService) {}

  @Permissions({ module: "inquiry_sources", action: "read" })
  @Get()
  async list() {
    return this.inquirySourcesService.list();
  }

  @Permissions({ module: "inquiry_sources", action: "manage" })
  @Post()
  async create(@Body() dto: CreateInquirySourceDto, @Req() req: AuthedRequest) {
    return this.inquirySourcesService.create(dto, actorFrom(req));
  }

  @Permissions({ module: "inquiry_sources", action: "manage" })
  @Patch(":code/status")
  async updateStatus(
    @Param("code") code: string,
    @Body() dto: UpdateInquirySourceStatusDto,
    @Req() req: AuthedRequest,
  ) {
    return this.inquirySourcesService.updateStatus(code, dto.status, actorFrom(req));
  }
}
