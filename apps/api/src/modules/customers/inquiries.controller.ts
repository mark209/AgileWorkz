import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { InquiriesService } from "./inquiries.service";
import { QuotationsService } from "../quotations/quotations.service";
import { UpdateInquiryDto } from "./dto/update-inquiry.dto";
import { ConvertInquiryToQuotationDto } from "../quotations/dto/convert-inquiry-to-quotation.dto";
import { Permissions } from "../../common/guards/permissions.decorator";
// No @UseGuards(PermissionsGuard) — see customers.controller.ts.

interface AuthedRequest extends Request {
  user: { userId: string };
}

function actorFrom(req: AuthedRequest) {
  return { userId: req.user.userId, ipAddress: req.ip, userAgent: req.get("user-agent") ?? undefined };
}

@Controller("inquiries")
export class InquiriesController {
  constructor(
    private readonly inquiriesService: InquiriesService,
    private readonly quotationsService: QuotationsService,
  ) {}

  @Permissions({ module: "inquiries", action: "read" })
  @Get(":id")
  async get(@Param("id") id: string) {
    return this.inquiriesService.findByIdOrThrow(id);
  }

  @Permissions({ module: "inquiries", action: "update" })
  @Patch(":id")
  async update(@Param("id") id: string, @Body() dto: UpdateInquiryDto, @Req() req: AuthedRequest) {
    return this.inquiriesService.update(id, dto, actorFrom(req));
  }

  // Step 3 correction: separate permission, matching the Phase 2 precedent
  // for every other status-transition endpoint (customers/contacts/sites/
  // assets/equipment_systems.deactivate) rather than riding along with
  // inquiries.update.
  @Permissions({ module: "inquiries", action: "close" })
  @Patch(":id/close")
  async close(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.inquiriesService.close(id, actorFrom(req));
  }

  // Step 5. Gated by quotations.create, not a dedicated inquiries.convert
  // permission — per your explicit Step 3 correction instruction: the
  // primary act is creating a quotation, with the inquiry flip a bookkeeping
  // side-effect of that same action. Revisit only if a real workflow need
  // for a separate gate shows up later.
  @Permissions({ module: "quotations", action: "create" })
  @Post(":id/quotations")
  async convertToQuotation(
    @Param("id") id: string,
    @Body() dto: ConvertInquiryToQuotationDto,
    @Req() req: AuthedRequest,
  ) {
    return this.quotationsService.createFromInquiry(id, dto, actorFrom(req));
  }
}
