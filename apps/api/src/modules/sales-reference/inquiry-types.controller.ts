import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { InquiryTypesService } from "./inquiry-types.service";
import { CreateInquiryTypeDto } from "./dto/create-inquiry-type.dto";
import { UpdateInquiryTypeStatusDto } from "./dto/update-inquiry-type-status.dto";
import { Permissions } from "../../common/guards/permissions.decorator";

interface AuthedRequest extends Request {
  user: { userId: string };
}

function actorFrom(req: AuthedRequest) {
  return { userId: req.user.userId, ipAddress: req.ip, userAgent: req.get("user-agent") ?? undefined };
}

@Controller("inquiry-types")
export class InquiryTypesController {
  constructor(private readonly inquiryTypesService: InquiryTypesService) {}

  @Permissions({ module: "inquiry_types", action: "read" })
  @Get()
  async list() {
    return this.inquiryTypesService.list();
  }

  @Permissions({ module: "inquiry_types", action: "manage" })
  @Post()
  async create(@Body() dto: CreateInquiryTypeDto, @Req() req: AuthedRequest) {
    return this.inquiryTypesService.create(dto, actorFrom(req));
  }

  @Permissions({ module: "inquiry_types", action: "manage" })
  @Patch(":code/status")
  async updateStatus(@Param("code") code: string, @Body() dto: UpdateInquiryTypeStatusDto, @Req() req: AuthedRequest) {
    return this.inquiryTypesService.updateStatus(code, dto.status, actorFrom(req));
  }
}
