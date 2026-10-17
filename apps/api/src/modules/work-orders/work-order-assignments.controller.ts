import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { WorkOrderAssignmentsService } from "./work-order-assignments.service";
import { CreateAssignmentDto } from "./dto/create-assignment.dto";
import { Permissions } from "../../common/guards/permissions.decorator";
// No @UseGuards(PermissionsGuard) — it's already global; see customers.controller.ts.

interface AuthedRequest extends Request {
  user: { userId: string };
}

function actorFrom(req: AuthedRequest) {
  return { userId: req.user.userId, ipAddress: req.ip, userAgent: req.get("user-agent") ?? undefined };
}

// Step 4 — work_orders.assign (Office Staff+ only, §07). Technician holds
// neither this permission nor any route on this controller — its only
// access is read_own on WorkOrdersController (GET /work-orders/:id and
// /work-orders/mine).
@Controller("work-orders/:workOrderId/assignments")
export class WorkOrderAssignmentsController {
  constructor(private readonly assignmentsService: WorkOrderAssignmentsService) {}

  @Permissions({ module: "work_orders", action: "assign" })
  @Get()
  async list(@Param("workOrderId") workOrderId: string, @Req() req: AuthedRequest) {
    return this.assignmentsService.listForWorkOrder(workOrderId, req.user.userId);
  }

  @Permissions({ module: "work_orders", action: "assign" })
  @Post()
  async assign(@Param("workOrderId") workOrderId: string, @Body() dto: CreateAssignmentDto, @Req() req: AuthedRequest) {
    return this.assignmentsService.assign(workOrderId, dto, actorFrom(req));
  }

  @Permissions({ module: "work_orders", action: "assign" })
  @Patch(":assignmentId/unassign")
  async unassign(
    @Param("workOrderId") workOrderId: string,
    @Param("assignmentId") assignmentId: string,
    @Req() req: AuthedRequest,
  ) {
    return this.assignmentsService.unassign(workOrderId, assignmentId, actorFrom(req));
  }
}
