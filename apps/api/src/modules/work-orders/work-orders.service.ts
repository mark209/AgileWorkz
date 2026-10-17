import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import {
  ActorType,
  MaintenanceFrequency,
  NumberSeries,
  Prisma,
  QuotationRevisionStatus,
  QuotationType,
  WorkOrder,
  WorkOrderStatus,
  WorkOrderType,
  UserStatus,
} from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { NumberingService } from "../../common/numbering/numbering.service";
import { PermissionsService } from "../identity/permissions.service";
import { ServiceAccessService } from "../identity/service-access.service";
import { ActorContext } from "../identity/users.service";
import { CreateStandaloneWorkOrderDto } from "./dto/create-standalone-work-order.dto";
import { ConvertToWorkOrdersDto } from "./dto/convert-to-work-orders.dto";
import { ScheduleWorkOrderDto } from "./dto/schedule-work-order.dto";
import { RequestCancelWorkOrderDto } from "./dto/request-cancel-work-order.dto";
import { CancelWorkOrderDto } from "./dto/cancel-work-order.dto";
import { GenerateMaintenanceVisitsDto } from "./dto/generate-maintenance-visits.dto";
import { aggregateEstimatedCost } from "./estimated-cost.util";
import { generateMaintenanceVisitDates } from "./maintenance-visit-schedule.util";

// Step 3 scope: Work Order creation via both paths. Step 4 added the
// assignment module and the server-side ownership enforcement behind
// work_orders.read_own (D4). Step 5 added the lifecycle/status state machine
// (§04): schedule/start/complete/close/request-cancel/cancel/dismiss. Step 6
// adds recurring-maintenance visit generation (§08/D7/D8) below. Actual-cost
// capture and every other later-phase concern remain deliberately
// untouched — see the Step 3/4/5/6 reports.
const CANCELLABLE_STATUSES: WorkOrderStatus[] = [WorkOrderStatus.DRAFT, WorkOrderStatus.SCHEDULED, WorkOrderStatus.IN_PROGRESS];

/**
 * Phase 4 Operations Frontend (approved Decision 5) — a lightweight,
 * read-only enrichment applied to every list/detail query below, joining in
 * exactly what a dispatch-oriented list or detail screen needs (customer
 * name, site label, currently-active assignments with the technician's
 * name) in the SAME query, never as a per-row follow-up fetch. No schema
 * change: every field here already existed as a real relation
 * (WorkOrder.customer/site, WorkOrderAssignment.technician) — this only
 * widens what a single query selects. Purely additive to every existing
 * consumer (e.g. the frozen Phase 6 Dashboard, which reads only `.status`/
 * `.cancellationRequestedAt`/`.cancelledAt` from this same shape) — no
 * existing field was removed or renamed.
 */
const WORK_ORDER_LIST_INCLUDE = {
  customer: { select: { id: true, name: true } },
  site: { select: { id: true, label: true } },
  responsibleManager: { select: { id: true, fullName: true } },
  assignments: {
    where: { unassignedAt: null },
    orderBy: { assignedAt: "asc" as const },
    include: { technician: { select: { id: true, fullName: true } } },
  },
} satisfies Prisma.WorkOrderInclude;

const WORK_ORDER_DETAIL_INCLUDE = {
  ...WORK_ORDER_LIST_INCLUDE,
  tasks: { orderBy: { sortOrder: "asc" as const } },
} satisfies Prisma.WorkOrderInclude;

@Injectable()
export class WorkOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly permissions: PermissionsService,
    private readonly access: ServiceAccessService,
  ) {}

  // Plain existence check, no ownership/permission branching — used
  // internally (e.g. by WorkOrderAssignmentsService to validate the parent
  // Work Order exists) and by any Office Staff+ caller that already holds
  // the unscoped work_orders.read permission via the guard. Do not call
  // this from a route reachable by a Technician — see getForActor.
  async findByIdOrThrow(id: string) {
    const workOrder = await this.prisma.workOrder.findUnique({ where: { id }, include: WORK_ORDER_DETAIL_INCLUDE });
    if (!workOrder) throw new NotFoundException("Work Order not found");
    return workOrder;
  }

  // D4 — the server-side ownership enforcement behind work_orders.read_own.
  // GET /work-orders/:id carries no static @Permissions() decorator
  // (deliberately — PermissionsGuard only ANDs a fixed list, it has no
  // "read OR read_own" concept), so this method is what actually decides
  // access: full work_orders.read always wins; read_own wins only when the
  // caller has an ACTIVE row in work_order_assignments for this exact Work
  // Order; anyone with neither gets 403. This is enforced here, in the
  // service, against the database — never inferred from anything the UI
  // did or didn't show, and never bypassable by calling the API directly
  // with a known Work Order id.
  async getForActor(id: string, actor: ActorContext) {
    await this.access.assertWorkOrderReadable(id, actor.userId);
    const workOrder = await this.prisma.workOrder.findUnique({ where: { id }, include: WORK_ORDER_DETAIL_INCLUDE });
    if (!workOrder) throw new NotFoundException("Work Order not found");
    return workOrder;
  }

  // GET /work-orders/mine — work_orders.read_own (guard-gated: this route
  // has nothing to branch on, unlike getForActor, since it's exclusively a
  // "my own" view). Filters at the query itself, not in application code
  // after a broader fetch — an ended assignment (unassignedAt set) never
  // matches, so it stops appearing here the moment it's ended (D4/§07).
  async listForTechnician(technicianId: string) {
    return this.prisma.workOrder.findMany({
      where: { assignments: { some: { technicianId, unassignedAt: null } } },
      orderBy: { createdAt: "desc" },
      include: WORK_ORDER_LIST_INCLUDE,
    });
  }

  async listForCustomer(customerId: string, actor?: ActorContext) {
    await this.assertCustomerExists(customerId);
    const scope = actor ? await this.access.workOrderFilter(actor.userId) : {};
    return this.prisma.workOrder.findMany({ where: { customerId, ...scope }, orderBy: { createdAt: "desc" }, include: WORK_ORDER_LIST_INCLUDE });
  }

  /**
   * Phase 6 (Dashboard) addition — global, cross-customer listing,
   * optionally filtered by status. Same precedent as
   * QuotationsService.listAllOrByStatus / ServiceReportsService.listByStatus
   * — no new permission, no aggregate table. `statuses`
   * undefined/empty returns every Work Order, matching listForCustomer's
   * own no-implicit-filter shape.
   */
  async listAllOrByStatus(statuses?: WorkOrderStatus[], actor?: ActorContext, assignedOnly = false) {
    const authorizedScope = actor ? await this.access.workOrderFilter(actor.userId) : {};
    const scope = assignedOnly && actor ? { ...authorizedScope, responsibleManagerId: actor.userId } : authorizedScope;
    return this.prisma.workOrder.findMany({
      where: { ...scope, ...(statuses && statuses.length > 0 ? { status: { in: statuses } } : {}) },
      orderBy: { createdAt: "desc" },
      include: WORK_ORDER_LIST_INCLUDE,
    });
  }

  // --- Step 5: lifecycle / status state machine (§04) ---------------------

  // PATCH /work-orders/:id/schedule — work_orders.update (§04: "Office
  // Staff/Manager/Admin"; no dedicated permission exists for this
  // transition in the resolved §07 matrix, so it reuses the general "edit a
  // Work Order's fields" grant every Office Staff+ role already holds).
  // DRAFT -> SCHEDULED only, and only once both preconditions are met: at
  // least one ACTIVE technician assignment, and a scheduledDate (already
  // stored, or supplied here).
  async schedule(id: string, dto: ScheduleWorkOrderDto, actor: ActorContext) {
    await this.access.assertManagerScopedAction(id, actor.userId);
    const before = await this.findByIdOrThrow(id);
    if (before.status !== WorkOrderStatus.DRAFT) {
      throw new BadRequestException(`Only a DRAFT Work Order can be scheduled — this Work Order is ${before.status}`);
    }
    if (before.assignments.length === 0) {
      throw new BadRequestException("At least one technician must be actively assigned before scheduling");
    }
    const scheduledDate = dto.scheduledDate ? new Date(dto.scheduledDate) : before.scheduledDate;
    if (!scheduledDate) {
      throw new BadRequestException("A scheduledDate is required to move to SCHEDULED");
    }

    const after = await this.prisma.$transaction(async (tx) => {
      const guarded = await tx.workOrder.updateMany({
        where: { id, status: WorkOrderStatus.DRAFT },
        data: { status: WorkOrderStatus.SCHEDULED, scheduledDate },
      });
      if (guarded.count === 0) {
        throw new ConflictException("This Work Order is no longer DRAFT — it may have just been actioned by someone else");
      }
      return tx.workOrder.findUniqueOrThrow({ where: { id } });
    });

    await this.writeTransitionAudit(after, actor, "work_order_scheduled", { status: before.status }, {
      status: after.status,
      scheduledDate: after.scheduledDate,
    });
    return after;
  }

  // PATCH /work-orders/:id/start — work_orders.start_own, Technician only
  // (§07/D6). Two-layered backend enforcement, identical in shape to
  // getForActor's read_own check: the permission grant (checked by the
  // guard before this method ever runs) is necessary but not sufficient —
  // the caller must ALSO have an ACTIVE row in work_order_assignments for
  // this exact Work Order. Holding start_own alone never lets a technician
  // start a job they are not on. SCHEDULED -> IN_PROGRESS only.
  async startOwn(id: string, actor: ActorContext) {
    const before = await this.prisma.workOrder.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("Work Order not found");
    if (before.status !== WorkOrderStatus.SCHEDULED) {
      throw new BadRequestException(`Only a SCHEDULED Work Order can be started — this Work Order is ${before.status}`);
    }

    const activeAssignment = await this.prisma.workOrderAssignment.findFirst({
      where: { workOrderId: id, technicianId: actor.userId, unassignedAt: null },
    });
    if (!activeAssignment) {
      throw new ForbiddenException("You are not currently assigned to this Work Order");
    }

    const after = await this.prisma.$transaction(async (tx) => {
      const guarded = await tx.workOrder.updateMany({
        where: { id, status: WorkOrderStatus.SCHEDULED },
        data: { status: WorkOrderStatus.IN_PROGRESS, startedAt: new Date(), startedBy: actor.userId },
      });
      if (guarded.count === 0) {
        throw new ConflictException("This Work Order is no longer SCHEDULED — it may have just been actioned by someone else");
      }
      return tx.workOrder.findUniqueOrThrow({ where: { id } });
    });

    await this.writeTransitionAudit(after, actor, "work_order_started", { status: before.status }, {
      status: after.status,
      startedAt: after.startedAt,
      startedBy: after.startedBy,
    });
    return after;
  }

  // PATCH /work-orders/:id/field-complete — work_orders.field_complete_own,
  // Technician only (RBAC correction). Same two-layered enforcement shape as
  // startOwn: the permission grant is necessary but not sufficient — the
  // caller must ALSO have an ACTIVE row in work_order_assignments for this
  // exact Work Order. Deliberately does NOT change `status` — it stays
  // IN_PROGRESS. This is the technician's own "field work done, ready for
  // review" signal, distinct from the office/management-only complete()
  // below, which alone is authoritative and alone changes status to
  // COMPLETED. Idempotent: a second call (e.g. a crew's other actively-
  // assigned technician, or a retry over flaky field connectivity) is a
  // no-op that returns the existing record rather than erroring — only a
  // genuinely wrong state (not IN_PROGRESS, e.g. someone already closed or
  // cancelled it) is rejected.
  async fieldCompleteOwn(id: string, actor: ActorContext) {
    const before = await this.plainFindOrThrow(id);

    const activeAssignment = await this.prisma.workOrderAssignment.findFirst({
      where: { workOrderId: id, technicianId: actor.userId, unassignedAt: null },
    });
    if (!activeAssignment) {
      throw new ForbiddenException("You are not currently assigned to this Work Order");
    }

    if (before.status !== WorkOrderStatus.IN_PROGRESS) {
      throw new BadRequestException(
        `Only an IN_PROGRESS Work Order's field portion can be marked complete — this Work Order is ${before.status}`,
      );
    }

    if (before.fieldCompletedAt) {
      return before;
    }

    // wroteNow — not `before`'s pre-transaction snapshot — is the sole
    // source of truth for whether THIS call is the one that actually
    // performed the write. Under a genuine race, two concurrent callers can
    // both see fieldCompletedAt === null in `before`, but the `WHERE
    // fieldCompletedAt: null` guard inside updateMany is atomic at the
    // database level: only one of them can ever get guarded.count === 1.
    // Deciding "should I audit-log?" from `before` instead (as an earlier
    // version of this method did) let both racing callers see the other's
    // completed `after` state and both write an audit entry — this is what
    // that looked like and why it's wrong.
    const { after, wroteNow } = await this.prisma.$transaction(async (tx) => {
      const guarded = await tx.workOrder.updateMany({
        where: { id, status: WorkOrderStatus.IN_PROGRESS, fieldCompletedAt: null },
        data: { fieldCompletedAt: new Date(), fieldCompletedBy: actor.userId },
      });
      const current = await tx.workOrder.findUniqueOrThrow({ where: { id } });
      // guarded.count === 0 means another actively-assigned technician (or
      // this same one, retrying) already set it a moment ago — treat as the
      // same idempotent success, not a conflict: the end state
      // (fieldCompletedAt set, status unchanged) is identical either way.
      return { after: current, wroteNow: guarded.count > 0 };
    });

    if (wroteNow) {
      await this.writeTransitionAudit(after, actor, "work_order_field_completed", { fieldCompletedAt: null }, {
        fieldCompletedAt: after.fieldCompletedAt,
        fieldCompletedBy: after.fieldCompletedBy,
      });
    }
    return after;
  }

  // PATCH /work-orders/:id/complete — work_orders.complete (Office Staff+,
  // §07). IN_PROGRESS -> COMPLETED only — field/technical execution
  // finished, deliberately NOT the same as CLOSED (§04/D2).
  async complete(id: string, actor: ActorContext) {
    await this.access.assertManagerScopedAction(id, actor.userId);
    const before = await this.plainFindOrThrow(id);
    if (before.status !== WorkOrderStatus.IN_PROGRESS) {
      throw new BadRequestException(`Only an IN_PROGRESS Work Order can be completed — this Work Order is ${before.status}`);
    }

    const after = await this.prisma.$transaction(async (tx) => {
      const submittedReports = await tx.serviceReport.count({ where: { workOrderId: id } });
      if (submittedReports === 0) {
        throw new BadRequestException("Upload a Service Report before completing this Work Order");
      }
      const guarded = await tx.workOrder.updateMany({
        where: { id, status: WorkOrderStatus.IN_PROGRESS },
        data: { status: WorkOrderStatus.COMPLETED, completedAt: new Date(), completedBy: actor.userId },
      });
      if (guarded.count === 0) {
        throw new ConflictException("This Work Order is no longer IN_PROGRESS — it may have just been actioned by someone else");
      }
      return tx.workOrder.findUniqueOrThrow({ where: { id } });
    });

    await this.writeTransitionAudit(after, actor, "work_order_completed", { status: before.status }, {
      status: after.status,
      completedAt: after.completedAt,
      completedBy: after.completedBy,
    });
    return after;
  }

  // PATCH /work-orders/:id/close — work_orders.close, Manager/Admin-Owner
  // only (§07/D2 — the final administrative sign-off, deliberately excluding
  // Office Staff). COMPLETED -> CLOSED only.
  async close(id: string, actor: ActorContext) {
    await this.access.assertManagerScopedAction(id, actor.userId);
    const before = await this.plainFindOrThrow(id);
    if (before.status !== WorkOrderStatus.COMPLETED) {
      throw new BadRequestException(`Only a COMPLETED Work Order can be closed — this Work Order is ${before.status}`);
    }

    const after = await this.prisma.$transaction(async (tx) => {
      const verifiedReports = await tx.serviceReport.count({
        where: { workOrderId: id, status: { in: ["VERIFIED", "CONFIRMED", "LOCKED"] } },
      });
      if (verifiedReports === 0) {
        throw new BadRequestException("A verified Service Report is required before closing this Work Order");
      }
      const guarded = await tx.workOrder.updateMany({
        where: { id, status: WorkOrderStatus.COMPLETED },
        data: { status: WorkOrderStatus.CLOSED, closedAt: new Date(), closedBy: actor.userId },
      });
      if (guarded.count === 0) {
        throw new ConflictException("This Work Order is no longer COMPLETED — it may have just been actioned by someone else");
      }
      return tx.workOrder.findUniqueOrThrow({ where: { id } });
    });

    await this.writeTransitionAudit(after, actor, "work_order_closed", { status: before.status }, {
      status: after.status,
      closedAt: after.closedAt,
      closedBy: after.closedBy,
    });
    return after;
  }

  // PATCH /work-orders/:id/request-cancel — work_orders.request_cancel,
  // Office Staff+ (§07/D5). Never changes status — only records the
  // request. Valid only while the Work Order is still in a cancellable
  // status (§04: "Reachable from DRAFT, SCHEDULED, IN_PROGRESS" is the same
  // set a request can target, since a request that could never be
  // confirmed would be meaningless).
  async requestCancel(id: string, dto: RequestCancelWorkOrderDto, actor: ActorContext) {
    await this.access.assertManagerScopedAction(id, actor.userId);
    const before = await this.plainFindOrThrow(id);
    if (!CANCELLABLE_STATUSES.includes(before.status)) {
      throw new BadRequestException(`Cannot request cancellation of a Work Order that is ${before.status}`);
    }

    const after = await this.prisma.workOrder.update({
      where: { id },
      data: {
        cancellationRequestedAt: new Date(),
        cancellationRequestedBy: actor.userId,
        cancellationRequestedReason: dto.reason,
      },
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "work_order_cancellation_requested",
      entityType: "work_order",
      entityId: id,
      beforeData: { cancellationRequestedReason: before.cancellationRequestedReason },
      afterData: { cancellationRequestedReason: after.cancellationRequestedReason },
      reason: dto.reason,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return after;
  }

  // PATCH /work-orders/:id/cancel — work_orders.cancel, Manager/Admin-Owner
  // only, FINAL authority (§07/D5) — confirms a pending request or cancels
  // directly with no prior request, using the same permission either way.
  // Always requires its own explicit reason, same "restate the reason at
  // the point of action" convention as Phase 3's rejectRevision/
  // expireRevision. The prior request fields (if any) are left untouched as
  // a historical record — cancelledAt/By/cancellationReason are the actual
  // authority's own fields, never overwritten onto the request fields.
  async cancel(id: string, dto: CancelWorkOrderDto, actor: ActorContext) {
    await this.access.assertManagerScopedAction(id, actor.userId);
    const before = await this.plainFindOrThrow(id);
    if (!CANCELLABLE_STATUSES.includes(before.status)) {
      throw new BadRequestException(`Cannot cancel a Work Order that is ${before.status}`);
    }

    const after = await this.prisma.$transaction(async (tx) => {
      const guarded = await tx.workOrder.updateMany({
        where: { id, status: { in: CANCELLABLE_STATUSES } },
        data: {
          status: WorkOrderStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: actor.userId,
          cancellationReason: dto.reason,
        },
      });
      if (guarded.count === 0) {
        throw new ConflictException(
          "This Work Order is no longer in a cancellable status — it may have just been actioned by someone else",
        );
      }
      return tx.workOrder.findUniqueOrThrow({ where: { id } });
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "work_order_cancelled",
      entityType: "work_order",
      entityId: id,
      beforeData: { status: before.status },
      afterData: { status: after.status, cancelledAt: after.cancelledAt, cancelledBy: after.cancelledBy },
      reason: dto.reason,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return after;
  }

  // PATCH /work-orders/:id/dismiss-cancellation-request — work_orders.cancel
  // (same final-authority permission — deciding NOT to cancel is still
  // exercising that authority, §04's "or dismisses" branch). Clears the
  // request fields; status is never touched here.
  async dismissCancellationRequest(id: string, actor: ActorContext) {
    await this.access.assertManagerScopedAction(id, actor.userId);
    const before = await this.plainFindOrThrow(id);
    if (!before.cancellationRequestedAt) {
      throw new BadRequestException("This Work Order has no pending cancellation request to dismiss");
    }

    const after = await this.prisma.workOrder.update({
      where: { id },
      data: { cancellationRequestedAt: null, cancellationRequestedBy: null, cancellationRequestedReason: null },
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "work_order_cancellation_dismissed",
      entityType: "work_order",
      entityId: id,
      beforeData: { cancellationRequestedReason: before.cancellationRequestedReason },
      afterData: { cancellationRequestedReason: null },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return after;
  }

  // --- Step 6: recurring maintenance -> Work Order generation (§08) -------

  // POST /quotations/:id/revisions/:revisionId/generate-maintenance-visits —
  // work_orders.generate_maintenance_visits (Office Staff+, §07). Manual
  // trigger only, D7: generates ALL scheduledVisits Work Orders upfront,
  // each DRAFT with its scheduledDate pre-set and no technician assigned,
  // each carrying quotationId (D8's project/contract grouping key) and this
  // exact quotationRevisionId. One generation per revision, ever — see the
  // idempotency guard below.
  async generateMaintenanceVisits(quotationId: string, revisionId: string, dto: GenerateMaintenanceVisitsDto, actor: ActorContext) {
    const quotation = await this.prisma.quotation.findUnique({ where: { id: quotationId } });
    if (!quotation) throw new NotFoundException("Quotation not found");

    const revision = await this.prisma.quotationRevision.findUnique({ where: { id: revisionId } });
    if (!revision || revision.quotationId !== quotationId) {
      throw new NotFoundException("Quotation revision not found");
    }

    if (quotation.quotationType !== QuotationType.PREVENTIVE_MAINTENANCE) {
      throw new BadRequestException(
        "Only a PREVENTIVE_MAINTENANCE quotation can generate maintenance visits — this quotation is " +
          quotation.quotationType,
      );
    }
    if (revision.status !== QuotationRevisionStatus.ACCEPTED) {
      throw new BadRequestException(
        `Only an ACCEPTED revision can generate maintenance visits — this revision is ${revision.status}`,
      );
    }

    const details = await this.prisma.quotationMaintenanceDetails.findUnique({ where: { quotationRevisionId: revisionId } });
    if (!details) {
      throw new BadRequestException(
        "This revision has no maintenance details configured (contractPeriodMonths/frequency/scheduledVisits/billingFrequency)",
      );
    }
    if (details.frequency === MaintenanceFrequency.CUSTOM) {
      throw new BadRequestException(
        "CUSTOM frequency has no defined interval in the current schema — automatic visit-date generation is not supported for it",
      );
    }
    if (details.scheduledVisits < 1) {
      throw new BadRequestException("scheduledVisits must be at least 1 to generate maintenance visits");
    }

    // Idempotency guard — a second trigger on the same revision would
    // otherwise silently double every visit. Scoped to this exact
    // revision (not the whole quotation), matching every other
    // revision-scoped guard in this service (e.g. convertRevision's
    // ACCEPTED check) — a later revision of the same quotation is free to
    // generate its own visits independently.
    const alreadyGenerated = await this.prisma.workOrder.findFirst({
      where: { quotationRevisionId: revisionId, workOrderType: WorkOrderType.FROM_QUOTATION },
      select: { id: true },
    });
    if (alreadyGenerated) {
      throw new ConflictException("Maintenance visits have already been generated for this revision");
    }

    const startDate = new Date(dto.startDate);
    const visitDates = generateMaintenanceVisitDates(startDate, details.frequency, details.scheduledVisits);

    const lineItems = await this.prisma.quotationLineItem.findMany({ where: { quotationRevisionId: revisionId } });
    const testingItems = await this.prisma.quotationTestingCommissioningItem.findMany({
      where: { quotationRevisionId: revisionId, included: true },
      orderBy: { sortOrder: "asc" },
    });

    const created = await this.prisma.$transaction(async (tx) => {
      const results: WorkOrder[] = [];
      for (let i = 0; i < visitDates.length; i++) {
        const workOrder = await this.createOneFromRevision(tx, {
          quotation,
          revision,
          description: `Preventive Maintenance — Visit ${i + 1} of ${visitDates.length}`,
          scheduledDate: visitDates[i],
          lineItems,
          testingItems,
          actor,
        });
        results.push(workOrder);
      }
      return results;
    });

    for (const workOrder of created) {
      await this.writeCreationAudit(workOrder, actor);
    }
    return created;
  }

  private async plainFindOrThrow(id: string) {
    const workOrder = await this.prisma.workOrder.findUnique({ where: { id } });
    if (!workOrder) throw new NotFoundException("Work Order not found");
    return workOrder;
  }

  private async writeTransitionAudit(
    workOrder: WorkOrder,
    actor: ActorContext,
    action: string,
    beforeData: Record<string, unknown>,
    afterData: Record<string, unknown>,
  ) {
    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action,
      entityType: "work_order",
      entityId: workOrder.id,
      beforeData,
      afterData,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }

  // Path B — POST /customers/:id/work-orders. work_orders.create (Office
  // Staff+ only, §07). No quotation involved at all: quotationId and
  // quotationRevisionId are never set, workOrderType is always STANDALONE.
  async createStandalone(customerId: string, dto: CreateStandaloneWorkOrderDto, actor: ActorContext) {
    await this.assertCustomerExists(customerId);
    await this.assertSiteValid(customerId, dto.siteId);
    if (dto.responsibleManagerId) await this.assertResponsibleManagerEligible(dto.responsibleManagerId);

    const workOrder = await this.prisma.$transaction(async (tx) => {
      const workOrderNumber = await this.numbering.generateNumber(tx, NumberSeries.WORK_ORDER);
      return tx.workOrder.create({
        data: {
          workOrderNumber,
          customerId,
          siteId: dto.siteId,
          quotationId: null,
          quotationRevisionId: null,
          workOrderType: WorkOrderType.STANDALONE,
          standaloneReason: dto.standaloneReason,
          standaloneReasonType: dto.standaloneReasonType,
          estimatedValue: dto.estimatedValue,
          scheduledDate: dto.scheduledDate ? new Date(dto.scheduledDate) : null,
          description: dto.description,
          createdBy: actor.userId,
          responsibleManagerId: dto.responsibleManagerId ?? null,
        },
      });
    });

    await this.writeCreationAudit(workOrder, actor);
    return workOrder;
  }

  // Path A — POST /quotations/:id/revisions/:revisionId/convert-to-work-orders.
  // work_orders.create (§07). Only an ACCEPTED revision may be converted
  // (§05, matching Phase 3's own C6 precedent for ACCEPTED). Scope/pricing
  // are read by reference (quotationId/quotationRevisionId) — nothing on the
  // quotation or revision itself is mutated by conversion.
  async convertRevision(quotationId: string, revisionId: string, dto: ConvertToWorkOrdersDto, actor: ActorContext) {
    if (dto.responsibleManagerId) await this.assertResponsibleManagerEligible(dto.responsibleManagerId);
    const quotation = await this.prisma.quotation.findUnique({ where: { id: quotationId } });
    if (!quotation) throw new NotFoundException("Quotation not found");

    const revision = await this.prisma.quotationRevision.findUnique({ where: { id: revisionId } });
    if (!revision || revision.quotationId !== quotationId) {
      throw new NotFoundException("Quotation revision not found");
    }
    if (revision.status !== QuotationRevisionStatus.ACCEPTED) {
      throw new BadRequestException(
        `Only an ACCEPTED revision can be converted to a Work Order — this revision is ${revision.status}`,
      );
    }

    // PM quotations produce many Work Orders (recurring visits) via the
    // dedicated generator the approved plan reserves for Step 6 (§08,
    // work_orders.generate_maintenance_visits) — deliberately not built
    // here, so this generic conversion path explicitly refuses PM revisions
    // rather than either silently creating the wrong shape of Work Order
    // (a single one-off) or reimplementing Step 6 early.
    if (quotation.quotationType === QuotationType.PREVENTIVE_MAINTENANCE) {
      throw new BadRequestException(
        "PREVENTIVE_MAINTENANCE quotations are not converted through this endpoint — recurring visit " +
          "generation (work_orders.generate_maintenance_visits) is a later Phase 4 step, not yet implemented.",
      );
    }

    const scheduledDate = dto.scheduledDate ? new Date(dto.scheduledDate) : null;
    const testingItems = await this.prisma.quotationTestingCommissioningItem.findMany({
      where: { quotationRevisionId: revisionId, included: true },
      orderBy: { sortOrder: "asc" },
    });

    let created: WorkOrder[];

    if (quotation.quotationType === QuotationType.PROJECT) {
      // D1 — one Work Order per section. Every quotation_testing_
      // commissioning_items row is revision-level, not section-level (no
      // section FK exists on that table), so each section's Work Order
      // receives the same full copy of the revision's checklist — there is
      // no finer-grained scoping the schema can express.
      const sections = await this.prisma.quotationSection.findMany({
        where: { quotationRevisionId: revisionId },
        orderBy: { sortOrder: "asc" },
      });
      if (sections.length === 0) {
        throw new BadRequestException(
          "This PROJECT revision has no sections — at least one section is required to convert it into Work Orders",
        );
      }

      created = await this.prisma.$transaction(async (tx) => {
        const results: WorkOrder[] = [];
        for (const section of sections) {
          const lineItems = await tx.quotationLineItem.findMany({ where: { sectionId: section.id } });
          const workOrder = await this.createOneFromRevision(tx, {
            quotation,
            revision,
            description: section.name,
            scheduledDate,
            lineItems,
            testingItems,
            actor,
            responsibleManagerId: dto.responsibleManagerId,
          });
          results.push(workOrder);
        }
        return results;
      });
    } else {
      // REPAIR / SUPPLY_INSTALLATION — one Work Order for the whole revision.
      created = await this.prisma.$transaction(async (tx) => {
        const lineItems = await tx.quotationLineItem.findMany({ where: { quotationRevisionId: revisionId } });
        const workOrder = await this.createOneFromRevision(tx, {
          quotation,
          revision,
          description: revision.scopeOfWork ?? undefined,
          scheduledDate,
          lineItems,
          testingItems,
          actor,
          responsibleManagerId: dto.responsibleManagerId,
        });
        return [workOrder];
      });
    }

    for (const workOrder of created) {
      await this.writeCreationAudit(workOrder, actor);
    }
    return created;
  }

  // The shared core of the conversion path — numbering, the costing
  // snapshot, and the WorkOrder + copied WorkOrderTask rows all happen here
  // exactly once, called once per resulting Work Order (once for a 1:1
  // conversion, once per section for a PROJECT conversion).
  private async createOneFromRevision(
    tx: Prisma.TransactionClient,
    params: {
      quotation: { id: string; customerId: string; siteId: string };
      revision: { id: string };
      description?: string;
      scheduledDate: Date | null;
      lineItems: Array<{
        quantity: Prisma.Decimal;
        unitPriceBeforeVat: Prisma.Decimal;
        totalInternalCost: Prisma.Decimal | null;
        grossProfitAmount: Prisma.Decimal | null;
      }>;
      testingItems: Array<{ id: string; description: string; sortOrder: number }>;
      actor: ActorContext;
      responsibleManagerId?: string;
    },
  ): Promise<WorkOrder> {
    const workOrderNumber = await this.numbering.generateNumber(tx, NumberSeries.WORK_ORDER);
    const { estimatedTotalCost, estimatedGrossProfitAmount, estimatedGrossMarginPercent } = aggregateEstimatedCost(
      params.lineItems,
    );

    const workOrder = await tx.workOrder.create({
      data: {
        workOrderNumber,
        customerId: params.quotation.customerId,
        siteId: params.quotation.siteId,
        quotationId: params.quotation.id,
        quotationRevisionId: params.revision.id,
        workOrderType: WorkOrderType.FROM_QUOTATION,
        estimatedTotalCost,
        estimatedGrossProfitAmount,
        estimatedGrossMarginPercent,
        scheduledDate: params.scheduledDate,
        description: params.description,
        createdBy: params.actor.userId,
        responsibleManagerId: params.responsibleManagerId ?? null,
      },
    });

    if (params.testingItems.length > 0) {
      await tx.workOrderTask.createMany({
        data: params.testingItems.map((item) => ({
          workOrderId: workOrder.id,
          description: item.description,
          sourceTestingItemId: item.id,
          sortOrder: item.sortOrder,
        })),
      });
    }

    return workOrder;
  }

  private async writeCreationAudit(workOrder: WorkOrder, actor: ActorContext) {
    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "work_order_created",
      entityType: "work_order",
      entityId: workOrder.id,
      afterData: {
        workOrderNumber: workOrder.workOrderNumber,
        workOrderType: workOrder.workOrderType,
        customerId: workOrder.customerId,
        siteId: workOrder.siteId,
        quotationId: workOrder.quotationId,
        quotationRevisionId: workOrder.quotationRevisionId,
        standaloneReasonType: workOrder.standaloneReasonType,
        status: workOrder.status,
        responsibleManagerId: workOrder.responsibleManagerId,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }

  async setResponsibleManager(id: string, managerId: string | null, actor: ActorContext) {
    const roles = await this.permissions.getRoleNames(actor.userId);
    if (!roles.includes("Admin/Owner")) throw new ForbiddenException("Only Admin/Owner may reassign the responsible Manager");
    if (managerId) await this.assertResponsibleManagerEligible(managerId);
    const before = await this.plainFindOrThrow(id);
    if (before.responsibleManagerId === managerId) return before;
    const changed = await this.prisma.workOrder.updateMany({
      where: { id, responsibleManagerId: before.responsibleManagerId },
      data: { responsibleManagerId: managerId },
    });
    if (changed.count === 0) throw new ConflictException("Responsible Manager changed concurrently");
    const after = await this.plainFindOrThrow(id);
    await this.writeTransitionAudit(after, actor, "work_order_manager_assigned", {
      responsibleManagerId: before.responsibleManagerId,
    }, { responsibleManagerId: managerId });
    return after;
  }

  private async assertResponsibleManagerEligible(managerId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: managerId },
      select: { status: true, userRoles: { where: { role: { name: "Manager" } }, select: { roleId: true } } },
    });
    if (!user || user.status !== UserStatus.ACTIVE || user.userRoles.length === 0) {
      throw new BadRequestException("Responsible Manager must be an active user with the Manager role");
    }
  }

  private async assertCustomerExists(customerId: string) {
    const exists = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!exists) throw new NotFoundException("Customer not found");
  }

  private async assertSiteValid(customerId: string, siteId: string) {
    const site = await this.prisma.site.findUnique({ where: { id: siteId }, select: { id: true, customerId: true } });
    if (!site) throw new NotFoundException("Site not found");
    if (site.customerId !== customerId) {
      throw new BadRequestException("Site must belong to the same customer as the Work Order");
    }
  }
}
