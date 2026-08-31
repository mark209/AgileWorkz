import { Controller, Get, Query } from "@nestjs/common";
import { AuditService } from "./audit.service";
import { Permissions } from "../../common/guards/permissions.decorator";

// Read-only controller by construction — there is no PATCH/PUT/DELETE
// handler anywhere in this file, matching AuditService's append-only shape.
//
// No @UseGuards(PermissionsGuard) here — PermissionsGuard is already
// registered globally via APP_GUARD in AppModule and runs for every route.
// Adding it again here would make Nest instantiate a second copy scoped to
// this module, which fails to resolve PermissionsService since AuditModule
// deliberately doesn't import IdentityModule (that would be circular, since
// IdentityModule imports AuditModule). @Permissions() alone is sufficient —
// it just sets metadata the global guard reads.
@Permissions({ module: "audit_logs", action: "read" })
@Controller("audit-logs")
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  async list(
    @Query("entityType") entityType?: string,
    @Query("entityId") entityId?: string,
    @Query("actorUserId") actorUserId?: string,
    @Query("action") action?: string,
    @Query("take") take?: string,
    @Query("skip") skip?: string,
  ) {
    return this.auditService.query({
      entityType,
      entityId,
      actorUserId,
      action,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }
}
