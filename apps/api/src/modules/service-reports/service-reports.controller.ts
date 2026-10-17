import { BadRequestException, Controller, Get, Param, Query, Req } from "@nestjs/common";
import { Request } from "express";
import { ServiceReportStatus } from "@prisma/client";
import { ServiceReportsService } from "./service-reports.service";
import { Permissions } from "../../common/guards/permissions.decorator";
// No @UseGuards(PermissionsGuard) — it's already global (AppModule's
// APP_GUARD); see customers.controller.ts.

interface AuthedRequest extends Request {
  user: { userId: string };
}

// The upload route (POST /customers/:id/service-reports) lives on
// CustomersController, not here — same nesting convention as Work Orders'
// standalone creation (customers.controller.ts), since every Service
// Report is customer+site scoped, not a flat/polymorphic resource like
// customer_documents. "mine" stays declared before ":id" so Nest's route
// matching never treats the literal segment "mine" as an id.
@Controller("service-reports")
export class ServiceReportsController {
  constructor(private readonly serviceReportsService: ServiceReportsService) {}

  @Permissions({ module: "service_reports", action: "read_own" })
  @Get("mine")
  async listMine(@Req() req: AuthedRequest) {
    return this.serviceReportsService.listForUploader(req.user.userId);
  }

  // Phase 4 Operations Frontend — lets the upload form (apps/field) populate
  // a real reportTypeCode dropdown instead of a hardcoded guess. Gated on
  // service_reports.upload, not a new permission — declared before ":id"
  // for the same route-matching reason as "mine" above.
  @Permissions({ module: "service_reports", action: "upload" })
  @Get("types")
  async listTypes() {
    return this.serviceReportsService.listActiveReportTypes();
  }

  // Phase 5 Step 5 — the verification queue. service_reports.read (not
  // read_own): Technician never holds it, so this route is structurally
  // unreachable for them regardless of what status is requested.
  @Get()
  async list(@Req() req: AuthedRequest, @Query("status") status?: string) {
    if (!status) return this.serviceReportsService.listByStatus([ServiceReportStatus.PENDING_VERIFICATION], { userId: req.user.userId });
    const statuses = status.split(",").map((s) => s.trim());
    const valid = Object.values(ServiceReportStatus);
    for (const s of statuses) {
      if (!valid.includes(s as ServiceReportStatus)) {
        throw new BadRequestException(`Unknown status: ${s}`);
      }
    }
    return this.serviceReportsService.listByStatus(statuses as ServiceReportStatus[], { userId: req.user.userId });
  }

  // D4-style — no @Permissions() here deliberately. PermissionsGuard only
  // ANDs a fixed permission list; there is no "read OR read_own" it can
  // express. getForActor resolves the caller's effective permissions
  // itself and enforces read (unscoped) vs. read_own (own-upload-only) —
  // see ServiceReportsService.getForActor.
  @Get(":id")
  async get(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.serviceReportsService.getForActor(id, { userId: req.user.userId });
  }
}
