import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { QuotationsService } from "./quotations.service";
import { QuotationSectionsService } from "./quotation-sections.service";
import { CreateSectionDto } from "./dto/create-section.dto";
import { UpdateSectionDto } from "./dto/update-section.dto";
import { ReorderSectionsDto } from "./dto/reorder-sections.dto";
import { Permissions } from "../../common/guards/permissions.decorator";

interface AuthedRequest extends Request {
  user: { userId: string };
}

function actorFrom(req: AuthedRequest) {
  return { userId: req.user.userId, ipAddress: req.ip, userAgent: req.get("user-agent") ?? undefined };
}

// Nested under both quotationId and revisionId — each method re-validates
// the pairing via QuotationsService.findRevisionOrThrow before delegating,
// same double-check pattern already used by QuotationsController.getRevision.
@Controller("quotations/:quotationId/revisions/:revisionId/sections")
export class QuotationSectionsController {
  constructor(
    private readonly quotationsService: QuotationsService,
    private readonly sectionsService: QuotationSectionsService,
  ) {}

  @Permissions({ module: "quotations", action: "read" })
  @Get()
  async list(@Param("quotationId") quotationId: string, @Param("revisionId") revisionId: string) {
    await this.quotationsService.findRevisionOrThrow(quotationId, revisionId);
    return this.sectionsService.list(revisionId);
  }

  @Permissions({ module: "quotations", action: "update" })
  @Post()
  async create(
    @Param("quotationId") quotationId: string,
    @Param("revisionId") revisionId: string,
    @Body() dto: CreateSectionDto,
    @Req() req: AuthedRequest,
  ) {
    await this.quotationsService.findRevisionOrThrow(quotationId, revisionId);
    return this.sectionsService.create(revisionId, dto, actorFrom(req));
  }

  @Permissions({ module: "quotations", action: "update" })
  @Patch("reorder")
  async reorder(
    @Param("quotationId") quotationId: string,
    @Param("revisionId") revisionId: string,
    @Body() dto: ReorderSectionsDto,
    @Req() req: AuthedRequest,
  ) {
    await this.quotationsService.findRevisionOrThrow(quotationId, revisionId);
    return this.sectionsService.reorder(revisionId, dto, actorFrom(req));
  }

  @Permissions({ module: "quotations", action: "update" })
  @Patch(":sectionId")
  async update(
    @Param("quotationId") quotationId: string,
    @Param("revisionId") revisionId: string,
    @Param("sectionId") sectionId: string,
    @Body() dto: UpdateSectionDto,
    @Req() req: AuthedRequest,
  ) {
    await this.quotationsService.findRevisionOrThrow(quotationId, revisionId);
    return this.sectionsService.update(revisionId, sectionId, dto, actorFrom(req));
  }

  @Permissions({ module: "quotations", action: "update" })
  @Delete(":sectionId")
  async remove(
    @Param("quotationId") quotationId: string,
    @Param("revisionId") revisionId: string,
    @Param("sectionId") sectionId: string,
    @Req() req: AuthedRequest,
  ) {
    await this.quotationsService.findRevisionOrThrow(quotationId, revisionId);
    await this.sectionsService.remove(revisionId, sectionId, actorFrom(req));
    return { success: true };
  }
}
