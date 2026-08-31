import { BadRequestException, Body, Controller, Get, Param, Patch, Query, Req } from "@nestjs/common";
import { Request } from "express";
import { WorkOrderStatus } from "@prisma/client";
import { WorkOrdersService } from "./work-orders.service";
import { ServiceReportsService } from "../service-reports/service-reports.service";
import { ScheduleWorkOrderDto } from "./dto/schedule-work-order.dto";
import { RequestCancelWorkOrderDto } from "./dto/request-cancel-work-order.dto";
import { CancelWorkOrderDto } from "./dto/cancel-work-order.dto";
import { Permissions } from "../../common/guards/permissions.decorator";
// No @UseGuards(PermissionsGuard) — it's already global (AppModule's
// APP_GUARD); see customers.controller.ts / quotations.controller.ts.

interface AuthedRequest extends Request {
  user: { userId: string };
}

function actorFrom(req: AuthedRequest) {
  return { userId: req.user.userId, ipAddress: req.ip, userAgent: req.get("user-agent") ?? undefined };
}

// Step 3 built creation, reachable via the nested routes on
// CustomersController (standalone) and QuotationsController (conversion).
// Step 4 added the Technician-facing surface: GET /work-orders/mine
// (work_orders.read_own, filtered at the query) and ownership enforcement
// on GET /:id (D4 — see WorkOrdersService.getForActor for why that route
// carries no static @Permissions()). Step 5 adds the lifecycle/status
// transition routes (§04) below — every one of them re-validates its own
// required source status inside the service, so an invalid transition is
// rejected there, not merely hidden here. "mine" stays declared before
// ":id" so Nest's route matching never treats the literal segment "mine"
// as an id; the lifecycle routes are all suffixed sub-paths of ":id" so
// they never collide with it either.
@Controller("work-orders")
export class WorkOrdersController {
  constructor(
    private readonly workOrdersService: WorkOrdersService,
    private readonly serviceReportsService: ServiceReportsService,
  ) {}

  // Phase 6 (Dashboard) — global, cross-customer listing, optionally
  // filtered by ?status=A,B. Gated on the unscoped work_orders.read only —
  // Technician (read_own/start_own) correctly gets 403 here, same as every
  // other unscoped route; their own jobs remain reachable only via
  // GET /work-orders/mine below. Same comma-separated-status convention
  // already approved for GET /service-reports and GET /quotations.
  @Permissions({ module: "work_orders", action: "read" })
  @Get()
  async list(@Query("status") status?: string) {
    if (!status) return this.workOrdersService.listAllOrByStatus();
    const statuses = status.split(",").map((s) => s.trim());
    const valid = Object.values(WorkOrderStatus);
    for (const s of statuses) {
      if (!valid.includes(s as WorkOrderStatus)) throw new BadRequestException(`Unknown status: ${s}`);
    }
    return this.workOrdersService.listAllOrByStatus(statuses as WorkOrderStatus[]);
  }

  @Permissions({ module: "work_orders", action: "read_own" })
  @Get("mine")
  async listMine(@Req() req: AuthedRequest) {
    return this.workOrdersService.listForTechnician(req.user.userId);
  }

  // D4 — no @Permissions() here deliberately. PermissionsGuard only ANDs a
  // fixed permission list; there is no "read OR read_own" it can express.
  // getForActor resolves the caller's effective permissions itself and
  // enforces read (unscoped) vs. read_own (active-assignment-only) —
  // anyone holding neither gets 403 from the service, same outward result
  // as a guard rejection, just decided one layer deeper by design.
  @Get(":id")
  async get(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.workOrdersService.getForActor(id, { userId: req.user.userId });
  }

  // DRAFT -> SCHEDULED. No dedicated permission exists for this transition
  // in the resolved §07 matrix, so it reuses work_orders.update — the
  // general "edit a Work Order's fields" grant every Office Staff+ role
  // already holds (§04's Who column: "Office Staff/Manager/Admin").
  @Permissions({ module: "work_orders", action: "update" })
  @Patch(":id/schedule")
  async schedule(@Param("id") id: string, @Body() dto: ScheduleWorkOrderDto, @Req() req: AuthedRequest) {
    return this.workOrdersService.schedule(id, dto, actorFrom(req));
  }

  // SCHEDULED -> IN_PROGRESS. work_orders.start_own (D6) — Technician only.
  // The guard checks the permission grant; WorkOrdersService.startOwn does
  // the second, backend-only layer (an ACTIVE assignment row for this exact
  // Work Order) that the guard has no way to express.
  @Permissions({ module: "work_orders", action: "start_own" })
  @Patch(":id/start")
  async start(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.workOrdersService.startOwn(id, actorFrom(req));
  }

  // IN_PROGRESS -> COMPLETED. work_orders.complete (Office Staff+, §07) —
  // deliberately distinct from close (§04/D2).
  @Permissions({ module: "work_orders", action: "complete" })
  @Patch(":id/complete")
  async complete(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.workOrdersService.complete(id, actorFrom(req));
  }

  // COMPLETED -> CLOSED. work_orders.close — Manager/Admin-Owner only
  // (§07/D2), the final administrative sign-off.
  @Permissions({ module: "work_orders", action: "close" })
  @Patch(":id/close")
  async close(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.workOrdersService.close(id, actorFrom(req));
  }

  // Records a cancellation request — never changes status (§04/D5).
  // work_orders.request_cancel, Office Staff+.
  @Permissions({ module: "work_orders", action: "request_cancel" })
  @Patch(":id/request-cancel")
  async requestCancel(@Param("id") id: string, @Body() dto: RequestCancelWorkOrderDto, @Req() req: AuthedRequest) {
    return this.workOrdersService.requestCancel(id, dto, actorFrom(req));
  }

  // Final authority — confirms (with or without a prior request).
  // work_orders.cancel, Manager/Admin-Owner only (§07/D5).
  @Permissions({ module: "work_orders", action: "cancel" })
  @Patch(":id/cancel")
  async cancel(@Param("id") id: string, @Body() dto: CancelWorkOrderDto, @Req() req: AuthedRequest) {
    return this.workOrdersService.cancel(id, dto, actorFrom(req));
  }

  // Declines a pending request without cancelling (§04's "or dismisses"
  // branch) — same final-authority permission as cancel itself.
  @Permissions({ module: "work_orders", action: "cancel" })
  @Patch(":id/dismiss-cancellation-request")
  async dismissCancellationRequest(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.workOrdersService.dismissCancellationRequest(id, actorFrom(req));
  }

  // Phase 4 Operations Frontend (approved Decision 1) — lets a Work Order
  // detail screen show its linked Service Reports. Gated on the existing
  // service_reports.read (not work_orders.read) since the thing being
  // authorized is "read Service Report data", matching the same
  // action-not-entity permission-naming discipline already used for
  // convertToWorkOrders (gated on work_orders.create, not quotations.*).
  // Never touches Phase 5's own extraction/verification/confirm/lock
  // pipeline — only lists rows that pipeline already produced.
  @Permissions({ module: "service_reports", action: "read" })
  @Get(":id/service-reports")
  async listServiceReports(@Param("id") id: string) {
    await this.workOrdersService.findByIdOrThrow(id);
    return this.serviceReportsService.listByWorkOrder(id);
  }
}
