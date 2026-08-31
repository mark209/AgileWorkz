import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { ServiceReportVerificationService } from "./service-report-verification.service";
import { SubmitFieldReviewDto } from "./dto/submit-field-review.dto";
import { isStagingCategory } from "./staging-category";
import { Permissions } from "../../common/guards/permissions.decorator";
// No @UseGuards(PermissionsGuard) — it's already global (AppModule's
// APP_GUARD); see service-reports.controller.ts.

interface AuthedRequest extends Request {
  user: { userId: string };
}

function actorFrom(req: AuthedRequest) {
  return { userId: req.user.userId, ipAddress: req.ip, userAgent: req.get("user-agent") ?? undefined };
}

/**
 * Phase 5 Step 5 — Human Verification Workflow. Every route requires
 * service_reports.verify, which PermissionsGuard checks purely against the
 * caller's role-granted permissions (Office Staff/Manager/Admin-Owner have
 * it seeded, Technician never does) — no uploader-identity check anywhere
 * in this controller or the service it calls, per the approved Step 5
 * decision that verification authorization is role-based only.
 */
@Controller("service-reports/:id/verification")
export class ServiceReportVerificationController {
  constructor(private readonly verification: ServiceReportVerificationService) {}

  @Permissions({ module: "service_reports", action: "verify" })
  @Get()
  async getView(@Param("id") id: string) {
    return this.verification.getVerificationView(id);
  }

  @Permissions({ module: "service_reports", action: "verify" })
  @Patch(":category/:rowId")
  async submitFieldReview(
    @Param("id") id: string,
    @Param("category") category: string,
    @Param("rowId") rowId: string,
    @Body() dto: SubmitFieldReviewDto,
    @Req() req: AuthedRequest,
  ) {
    if (!isStagingCategory(category)) {
      throw new BadRequestException(`Unknown field category: ${category}`);
    }
    return this.verification.submitFieldReview(id, category, rowId, dto, actorFrom(req));
  }

  @Permissions({ module: "service_reports", action: "verify" })
  @Get("bulk-confirm/preview")
  async previewBulkConfirm(@Param("id") id: string) {
    return this.verification.previewBulkConfirm(id);
  }

  @Permissions({ module: "service_reports", action: "verify" })
  @Post("bulk-confirm")
  async bulkConfirm(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.verification.bulkConfirmEligibleFields(id, actorFrom(req));
  }

  @Permissions({ module: "service_reports", action: "verify" })
  @Post("complete")
  async complete(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.verification.completeVerification(id, actorFrom(req));
  }
}
