import { Body, Controller, Get, Param, Patch, Req } from "@nestjs/common";
import { IsBoolean, IsOptional, IsString } from "class-validator";
import { Request } from "express";
import { Permissions } from "../../common/guards/permissions.decorator";
import { ReferenceSuggestionsService } from "./reference-suggestions.service";

class ReviewSuggestionDto {
  @IsBoolean()
  approved!: boolean;

  @IsOptional()
  @IsString()
  code?: string;
}

@Controller("reference-suggestions")
export class ReferenceSuggestionsController {
  constructor(private readonly suggestions: ReferenceSuggestionsService) {}

  @Permissions({ module: "system_settings", action: "manage" })
  @Get()
  listPending() { return this.suggestions.listPending(); }

  @Permissions({ module: "quotations", action: "read" })
  @Get("quotation-types")
  listApprovedQuotationTypes() { return this.suggestions.listApprovedQuotationTypes(); }

  @Permissions({ module: "system_settings", action: "manage" })
  @Patch(":id/review")
  review(@Param("id") id: string, @Body() dto: ReviewSuggestionDto, @Req() req: Request & { user: { userId: string } }) {
    return this.suggestions.review(id, dto.approved, dto.code, req.user.userId);
  }
}
