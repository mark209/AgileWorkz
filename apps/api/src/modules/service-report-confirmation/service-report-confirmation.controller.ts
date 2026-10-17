import { Controller, Get, Param, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { ServiceReportConfirmationService } from "./service-report-confirmation.service";
import { Permissions } from "../../common/guards/permissions.decorator";
import { ServiceAccessService } from "../identity/service-access.service";
// No @UseGuards(PermissionsGuard) — it's already global (AppModule's
// APP_GUARD); see service-reports.controller.ts.

interface AuthedRequest extends Request {
  user: { userId: string };
}

function actorFrom(req: AuthedRequest) {
  return { userId: req.user.userId, ipAddress: req.ip, userAgent: req.get("user-agent") ?? undefined };
}

/**
 * Phase 5 Step 6 — Confirm Report / Canonical Service Report Write.
 * Preview and Confirm require service_reports.confirm (Office
 * Staff/Manager/Admin-Owner, per the Phase 5 RBAC matrix already seeded in
 * prisma/seed.ts — Technician never holds it). The canonical viewer is
 * gated on the broader service_reports.read instead — a Manager/Admin-Owner
 * inspecting already-confirmed data doesn't need confirm authority, only
 * general read access, matching the same permission the verification queue
 * list uses (service-reports.controller.ts).
 */
@Controller("service-reports/:id")
export class ServiceReportConfirmationController {
  constructor(private readonly confirmation: ServiceReportConfirmationService, private readonly access: ServiceAccessService) {}

  @Permissions({ module: "service_reports", action: "confirm" })
  @Get("confirm/preview")
  async preview(@Param("id") id: string, @Req() req: AuthedRequest) {
    await this.access.assertManagerScopedReportAction(id, req.user.userId);
    return this.confirmation.preview(id);
  }

  @Permissions({ module: "service_reports", action: "confirm" })
  @Post("confirm")
  async confirm(@Param("id") id: string, @Req() req: AuthedRequest) {
    await this.access.assertManagerScopedReportAction(id, req.user.userId);
    return this.confirmation.confirm(id, actorFrom(req));
  }

  @Get("canonical")
  async getCanonical(@Param("id") id: string, @Req() req: AuthedRequest) {
    await this.access.assertFullReportReadable(id, req.user.userId);
    return this.confirmation.getCanonicalView(id);
  }

  // Phase 5 Step 7 — Lock. service_reports.lock is already seeded and
  // granted only to Admin/Owner and Manager (prisma/seed.ts) — Office
  // Staff and Technician structurally lack it, same enforcement mechanism
  // as every other permission in this controller.
  @Permissions({ module: "service_reports", action: "lock" })
  @Post("lock")
  async lock(@Param("id") id: string, @Req() req: AuthedRequest) {
    await this.access.assertManagerScopedReportAction(id, req.user.userId);
    return this.confirmation.lock(id, actorFrom(req));
  }
}
