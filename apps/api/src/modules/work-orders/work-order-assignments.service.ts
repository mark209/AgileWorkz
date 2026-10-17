import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ActorType, Prisma, UserStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ActorContext } from "../identity/users.service";
import { WorkOrdersService } from "./work-orders.service";
import { ServiceAccessService } from "../identity/service-access.service";
import { CreateAssignmentDto } from "./dto/create-assignment.dto";

// Step 4 — Assignment module (approved plan §06/§07, D3/D4). Append-only
// history by construction: assign() always INSERTs a new row, unassign()
// only ever sets unassigned_at/unassigned_by on an existing row — nothing
// here ever UPDATEs technician_id or DELETEs a row. Multiple simultaneously
// -active rows per Work Order are allowed (a crew, D3) and enforced not to
// double up on the same technician by the hand-added partial unique index
// from Step 1 (work_order_assignments_active_technician_key).
@Injectable()
export class WorkOrderAssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly workOrdersService: WorkOrdersService,
    private readonly access: ServiceAccessService,
  ) {}

  async listForWorkOrder(workOrderId: string, userId?: string) {
    if (userId) await this.access.assertManagerScopedAction(workOrderId, userId);
    await this.workOrdersService.findByIdOrThrow(workOrderId);
    return this.prisma.workOrderAssignment.findMany({ where: { workOrderId }, orderBy: { assignedAt: "asc" } });
  }

  // work_orders.assign (§07). Fast-path, friendly message for the common
  // (non-race) case — the real safety net against two concurrent assign
  // calls for the same technician is the partial unique index itself,
  // caught below as P2002, same "friendly check + real DB guard" split
  // already used by quotations.service.ts's createFromInquiry.
  async assign(workOrderId: string, dto: CreateAssignmentDto, actor: ActorContext) {
    await this.access.assertManagerScopedAction(workOrderId, actor.userId);
    await this.workOrdersService.findByIdOrThrow(workOrderId);
    await this.assertTechnicianValid(dto.technicianId);

    const existingActive = await this.prisma.workOrderAssignment.findFirst({
      where: { workOrderId, technicianId: dto.technicianId, unassignedAt: null },
    });
    if (existingActive) {
      throw new ConflictException("This technician is already actively assigned to this Work Order");
    }

    let assignment;
    try {
      assignment = await this.prisma.workOrderAssignment.create({
        data: { workOrderId, technicianId: dto.technicianId, assignedBy: actor.userId },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("This technician is already actively assigned to this Work Order");
      }
      throw err;
    }

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "work_order_technician_assigned",
      entityType: "work_order_assignment",
      entityId: assignment.id,
      afterData: { workOrderId, technicianId: dto.technicianId },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return assignment;
  }

  // work_orders.assign (§07). Ends exactly one historical row — never
  // deletes it. The optimistic `updateMany` guard (same pattern as
  // quotations.service.ts's approveRevision/rejectRevision) means two
  // concurrent unassign calls for the same row can never both "win".
  async unassign(workOrderId: string, assignmentId: string, actor: ActorContext) {
    await this.access.assertManagerScopedAction(workOrderId, actor.userId);
    const before = await this.prisma.workOrderAssignment.findUnique({ where: { id: assignmentId } });
    if (!before || before.workOrderId !== workOrderId) {
      throw new NotFoundException("Assignment not found");
    }
    if (before.unassignedAt !== null) {
      throw new BadRequestException("This assignment has already ended");
    }

    const guarded = await this.prisma.workOrderAssignment.updateMany({
      where: { id: assignmentId, unassignedAt: null },
      data: { unassignedAt: new Date(), unassignedBy: actor.userId },
    });
    if (guarded.count === 0) {
      throw new ConflictException("This assignment was already ended — it may have just been actioned by someone else");
    }

    const after = await this.prisma.workOrderAssignment.findUniqueOrThrow({ where: { id: assignmentId } });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "work_order_technician_unassigned",
      entityType: "work_order_assignment",
      entityId: assignmentId,
      beforeData: { unassignedAt: null },
      afterData: { unassignedAt: after.unassignedAt, unassignedBy: actor.userId },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  private async assertTechnicianValid(technicianId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: technicianId }, select: { id: true, status: true } });
    if (!user) throw new NotFoundException("User not found");
    if (user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException("Cannot assign an inactive/suspended user to a Work Order");
    }
  }
}
