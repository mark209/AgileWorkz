import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import { Request, Response } from "express";
import { QuotationRevisionStatus } from "@prisma/client";
import { QuotationsService } from "./quotations.service";
import { WorkOrdersService } from "../work-orders/work-orders.service";
import { QuotationPdfService } from "./pdf/quotation-pdf.service";
import { UpdateRevisionContentDto } from "./dto/update-revision-content.dto";
import { RejectRevisionDto } from "./dto/reject-revision.dto";
import { RecordDecisionDto } from "./dto/record-decision.dto";
import { ExpireRevisionDto } from "./dto/expire-revision.dto";
import { ConvertToWorkOrdersDto } from "../work-orders/dto/convert-to-work-orders.dto";
import { GenerateMaintenanceVisitsDto } from "../work-orders/dto/generate-maintenance-visits.dto";
import { Permissions } from "../../common/guards/permissions.decorator";
// No @UseGuards(PermissionsGuard) — see customers.controller.ts.

interface AuthedRequest extends Request {
  user: { userId: string };
}

function actorFrom(req: AuthedRequest) {
  return { userId: req.user.userId, ipAddress: req.ip, userAgent: req.get("user-agent") ?? undefined };
}

@Controller("quotations")
export class QuotationsController {
  constructor(
    private readonly quotationsService: QuotationsService,
    private readonly workOrdersService: WorkOrdersService,
    private readonly quotationPdfService: QuotationPdfService,
  ) {}

  // Phase 6 (Dashboard) — global, cross-customer listing, optionally
  // filtered by ?status=A,B. Same permission, same comma-separated-status
  // convention already approved for GET /service-reports (Phase 5 Step 5).
  @Permissions({ module: "quotations", action: "read" })
  @Get()
  async list(@Query("status") status?: string) {
    if (!status) return this.quotationsService.listAllOrByStatus();
    const statuses = status.split(",").map((s) => s.trim());
    const valid = Object.values(QuotationRevisionStatus);
    for (const s of statuses) {
      if (!valid.includes(s as QuotationRevisionStatus)) throw new BadRequestException(`Unknown status: ${s}`);
    }
    return this.quotationsService.listAllOrByStatus(statuses as QuotationRevisionStatus[]);
  }

  @Permissions({ module: "quotations", action: "read" })
  @Get(":id")
  async get(@Param("id") id: string) {
    return this.quotationsService.findByIdOrThrow(id);
  }

  @Permissions({ module: "quotations", action: "read" })
  @Get(":id/revisions")
  async listRevisions(@Param("id") id: string) {
    return this.quotationsService.listRevisions(id);
  }

  // Step 6 — Revision N+1, full copy-forward. Gated by quotations.create
  // (C5), same permission Revision 0 creation already uses.
  @Permissions({ module: "quotations", action: "create" })
  @Post(":id/revisions")
  async createNextRevision(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.quotationsService.createNextRevision(id, actorFrom(req));
  }

  @Permissions({ module: "quotations", action: "read" })
  @Get(":id/revisions/:revisionId")
  async getRevision(@Param("id") id: string, @Param("revisionId") revisionId: string) {
    return this.quotationsService.findRevisionOrThrow(id, revisionId);
  }

  @Permissions({ module: "quotations", action: "update" })
  @Patch(":id/revisions/:revisionId")
  async updateRevision(
    @Param("id") id: string,
    @Param("revisionId") revisionId: string,
    @Body() dto: UpdateRevisionContentDto,
    @Req() req: AuthedRequest,
  ) {
    await this.quotationsService.findRevisionOrThrow(id, revisionId);
    return this.quotationsService.updateRevisionContent(revisionId, dto, actorFrom(req));
  }

  // Step 7 — Approval / Submission / Rejection / Send / Decision Workflow.
  // Every route below re-validates the (quotationId, revisionId) pairing
  // via findRevisionOrThrow first, same convention as updateRevision above,
  // then delegates the actual state transition (including its own atomic
  // status guard) to the service.

  @Permissions({ module: "quotations", action: "update" })
  @Patch(":id/revisions/:revisionId/submit")
  async submit(@Param("id") id: string, @Param("revisionId") revisionId: string, @Req() req: AuthedRequest) {
    await this.quotationsService.findRevisionOrThrow(id, revisionId);
    return this.quotationsService.submitRevision(revisionId, actorFrom(req));
  }

  // quotations.approve — Admin/Owner and Manager only (§11), distinct from
  // quotations.update used by every other Step 7 route.
  @Permissions({ module: "quotations", action: "approve" })
  @Patch(":id/revisions/:revisionId/approve")
  async approve(@Param("id") id: string, @Param("revisionId") revisionId: string, @Req() req: AuthedRequest) {
    await this.quotationsService.findRevisionOrThrow(id, revisionId);
    return this.quotationsService.approveRevision(revisionId, actorFrom(req));
  }

  // quotations.reject — Admin/Owner and Manager only (§11).
  @Permissions({ module: "quotations", action: "reject" })
  @Patch(":id/revisions/:revisionId/reject")
  async reject(
    @Param("id") id: string,
    @Param("revisionId") revisionId: string,
    @Body() dto: RejectRevisionDto,
    @Req() req: AuthedRequest,
  ) {
    await this.quotationsService.findRevisionOrThrow(id, revisionId);
    return this.quotationsService.rejectRevision(revisionId, dto, actorFrom(req));
  }

  @Permissions({ module: "quotations", action: "update" })
  @Patch(":id/revisions/:revisionId/send")
  async send(@Param("id") id: string, @Param("revisionId") revisionId: string, @Req() req: AuthedRequest) {
    await this.quotationsService.findRevisionOrThrow(id, revisionId);
    return this.quotationsService.sendRevision(revisionId, actorFrom(req));
  }

  @Permissions({ module: "quotations", action: "update" })
  @Patch(":id/revisions/:revisionId/decision")
  async decision(
    @Param("id") id: string,
    @Param("revisionId") revisionId: string,
    @Body() dto: RecordDecisionDto,
    @Req() req: AuthedRequest,
  ) {
    await this.quotationsService.findRevisionOrThrow(id, revisionId);
    return this.quotationsService.recordRevisionDecision(revisionId, dto, actorFrom(req));
  }

  @Permissions({ module: "quotations", action: "update" })
  @Patch(":id/revisions/:revisionId/expire")
  async expire(
    @Param("id") id: string,
    @Param("revisionId") revisionId: string,
    @Body() dto: ExpireRevisionDto,
    @Req() req: AuthedRequest,
  ) {
    await this.quotationsService.findRevisionOrThrow(id, revisionId);
    return this.quotationsService.expireRevision(revisionId, dto, actorFrom(req));
  }

  // Two-level approval correction — same visibility as viewing the
  // quotation itself (quotations.read), draft or final: the PDF's own
  // DRAFT watermark / electronic-approval-section logic is what
  // distinguishes an unapproved export from a final one, not a separate
  // permission gate. @Res() bypasses Nest's normal JSON response pipeline
  // (same pattern already used by LocalStorageController.serve for a
  // binary response) — this handler sends the response itself.
  @Permissions({ module: "quotations", action: "read" })
  @Get(":id/revisions/:revisionId/pdf")
  async getPdf(@Param("id") id: string, @Param("revisionId") revisionId: string, @Res() res: Response) {
    const buffer = await this.quotationPdfService.generate(id, revisionId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="quotation-${id}-rev-${revisionId}.pdf"`);
    res.send(buffer);
  }

  // Phase 4 Step 3 — Path A. work_orders.create (§07), not quotations.*: the
  // action being authorized is "create a Work Order", not "edit this
  // quotation" — the revision itself is never mutated by conversion.
  @Permissions({ module: "work_orders", action: "create" })
  @Post(":id/revisions/:revisionId/convert-to-work-orders")
  async convertToWorkOrders(
    @Param("id") id: string,
    @Param("revisionId") revisionId: string,
    @Body() dto: ConvertToWorkOrdersDto,
    @Req() req: AuthedRequest,
  ) {
    return this.workOrdersService.convertRevision(id, revisionId, dto, actorFrom(req));
  }

  // Phase 4 Step 6 — recurring maintenance -> Work Order generation (§08).
  // work_orders.generate_maintenance_visits (§07), not quotations.*: same
  // rationale as convertToWorkOrders — this creates Work Orders, it never
  // mutates the quotation or revision itself.
  @Permissions({ module: "work_orders", action: "generate_maintenance_visits" })
  @Post(":id/revisions/:revisionId/generate-maintenance-visits")
  async generateMaintenanceVisits(
    @Param("id") id: string,
    @Param("revisionId") revisionId: string,
    @Body() dto: GenerateMaintenanceVisitsDto,
    @Req() req: AuthedRequest,
  ) {
    return this.workOrdersService.generateMaintenanceVisits(id, revisionId, dto, actorFrom(req));
  }
}
