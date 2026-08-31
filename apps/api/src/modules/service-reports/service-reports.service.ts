import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import * as crypto from "node:crypto";
import * as path from "node:path";
import {
  ActorType,
  NumberSeries,
  ReferenceStatus,
  ServiceReport,
  ServiceReportSourceType,
  ServiceReportStatus,
} from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ActorContext } from "../identity/users.service";
import { PermissionsService } from "../identity/permissions.service";
import { NumberingService } from "../../common/numbering/numbering.service";
import { STORAGE_PROVIDER, StorageProvider } from "../../common/storage/storage-provider.interface";
import { ExtractionQueueService } from "../../common/extraction/service-report-extraction.processor";
import { UploadServiceReportDto } from "./dto/upload-service-report.dto";

const STORAGE_KEY_PREFIX = "service-reports";

// Approved Phase 5 Step 4 decisions — not implementation assumptions unless
// noted. Deliberately mirrors customer_documents' own allowlist/size cap
// (documents.service.ts) for consistency across the codebase, since real
// Service Reports are the same kind of scanned/photographed document —
// widening either is a scope change, not a bug fix.
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB per file
export const ALLOWED_UPLOAD_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

/**
 * The client-safe projection of a ServiceReport row. documentFileKey is
 * deliberately never included — the approved requirement is "do not expose
 * storage internals or file paths to the client". documentFileName/
 * documentMimeType/documentFileSize describe the caller's own uploaded
 * file, not the storage system, and are safe to return.
 */
export type PublicServiceReport = Omit<ServiceReport, "documentFileKey">;

// Explicit field list rather than a spread-and-omit — a new column added to
// ServiceReport in a future migration is excluded from the client response
// by default (fails closed) instead of being silently exposed until
// someone remembers to add it to an exclusion list.
function toPublicServiceReport(report: ServiceReport): PublicServiceReport {
  return {
    id: report.id,
    serviceReportNumber: report.serviceReportNumber,
    customerId: report.customerId,
    siteId: report.siteId,
    workOrderId: report.workOrderId,
    reportTypeCode: report.reportTypeCode,
    sourceType: report.sourceType,
    status: report.status,
    serviceDate: report.serviceDate,
    timeIn: report.timeIn,
    timeOut: report.timeOut,
    reportReferenceNumber: report.reportReferenceNumber,
    contactName: report.contactName,
    contactPhone: report.contactPhone,
    generalNotes: report.generalNotes,
    documentMimeType: report.documentMimeType,
    documentFileName: report.documentFileName,
    documentFileSize: report.documentFileSize,
    uploadedBy: report.uploadedBy,
    uploadedAt: report.uploadedAt,
    verifiedBy: report.verifiedBy,
    verifiedAt: report.verifiedAt,
    confirmedBy: report.confirmedBy,
    confirmedAt: report.confirmedAt,
    lockedBy: report.lockedBy,
    lockedAt: report.lockedAt,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
  };
}

@Injectable()
export class ServiceReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionsService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly extractionQueue: ExtractionQueueService,
  ) {}

  /**
   * POST /customers/:customerId/service-reports (multipart). Creates the
   * canonical header row and enqueues the existing extraction job — the
   * queue processor built in Step 3 owns everything from here (storage
   * retrieval, staging writes, status transitions into
   * PENDING_VERIFICATION/EXTRACTION_FAILED). This method's only job is to
   * get a valid header row and a queued job into existence together, or
   * neither — see the rollback behavior below.
   */
  async upload(
    customerId: string,
    file: Express.Multer.File | undefined,
    dto: UploadServiceReportDto,
    actor: ActorContext,
  ): Promise<PublicServiceReport> {
    if (!file) {
      throw new BadRequestException("A file is required");
    }
    if (!ALLOWED_UPLOAD_MIME_TYPES.has(file.mimetype)) {
      throw new UnsupportedMediaTypeException(
        `Unsupported file type: ${file.mimetype}. Allowed types: ${[...ALLOWED_UPLOAD_MIME_TYPES].join(", ")}`,
      );
    }

    await this.assertCustomerExists(customerId);
    await this.assertSiteValid(customerId, dto.siteId);
    await this.assertReportTypeActive(dto.reportTypeCode);

    const workOrderId = dto.workOrderId ? await this.assertWorkOrderValid(dto.workOrderId, customerId, dto.siteId) : null;
    if (!workOrderId && !dto.sourceType) {
      // ServiceReport.sourceType's own schema comment: "required (app-
      // validated) when work_order_id is null" — there is no Work Order to
      // explain why this visit happened, so the caller must say.
      throw new BadRequestException("sourceType is required when no workOrderId is provided");
    }

    const id = crypto.randomUUID();
    const extension = path.extname(file.originalname);
    const fileKey = `${STORAGE_KEY_PREFIX}/${id}${extension}`;

    // Storage write happens before the DB row exists, never after — a row
    // must never reference an object that was never actually written
    // (same invariant as customer_documents' own upload path).
    await this.storage.putObject({ key: fileKey, body: file.buffer, contentType: file.mimetype });

    let report: ServiceReport;
    try {
      report = await this.prisma.$transaction(async (tx) => {
        const serviceReportNumber = await this.numbering.generateNumber(tx, NumberSeries.SERVICE_REPORT);
        return tx.serviceReport.create({
          data: {
            id,
            serviceReportNumber,
            customerId,
            siteId: dto.siteId,
            workOrderId,
            reportTypeCode: dto.reportTypeCode,
            sourceType: dto.sourceType ?? (workOrderId ? ServiceReportSourceType.WORK_ORDER_LINKED : null),
            status: ServiceReportStatus.PENDING_EXTRACTION,
            contactName: dto.contactName,
            contactPhone: dto.contactPhone,
            documentFileKey: fileKey,
            documentMimeType: file.mimetype,
            documentFileName: file.originalname,
            documentFileSize: file.size,
            uploadedBy: actor.userId,
            uploadedAt: new Date(),
          },
        });
      });
    } catch (e) {
      // Don't leave an orphaned object behind if the DB write fails right
      // after a successful upload (same pattern as customer_documents).
      await this.storage.deleteObject(fileKey).catch(() => undefined);
      throw e;
    }

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "service_report_uploaded",
      entityType: "ServiceReport",
      entityId: report.id,
      // Upload metadata only — never raw report contents, which don't even
      // exist yet at this point (extraction hasn't run).
      afterData: {
        serviceReportNumber: report.serviceReportNumber,
        reportTypeCode: report.reportTypeCode,
        customerId: report.customerId,
        siteId: report.siteId,
        workOrderId: report.workOrderId,
        fileName: report.documentFileName,
        fileSize: report.documentFileSize,
        mimeType: report.documentMimeType,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    try {
      await this.extractionQueue.enqueueExtraction({
        serviceReportId: report.id,
        documentFileKey: report.documentFileKey,
        documentMimeType: report.documentMimeType,
      });
    } catch (e) {
      // A PENDING_EXTRACTION report with no job behind it would sit stuck
      // forever — roll back the row and the storage object so the whole
      // upload is atomic from the caller's perspective. Audit the failure
      // first, while the row still exists, so there is a permanent record
      // of what was attempted even though the row itself is gone
      // afterward (audit_logs has no FK to service_reports — this is a
      // genuine unwind of a failed multi-step operation, not a disable-via-
      // status case like a confirmed business record).
      await this.audit.write({
        actorType: ActorType.USER,
        actorUserId: actor.userId,
        action: "service_report_extraction_enqueue_failed",
        entityType: "ServiceReport",
        entityId: report.id,
        reason: e instanceof Error ? e.message : String(e),
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
      await this.prisma.serviceReport.delete({ where: { id: report.id } }).catch(() => undefined);
      await this.storage.deleteObject(fileKey).catch(() => undefined);
      throw new InternalServerErrorException(
        "Upload succeeded but the extraction job could not be enqueued; the upload has been rolled back. Please retry.",
      );
    }

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "service_report_extraction_enqueued",
      entityType: "ServiceReport",
      entityId: report.id,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return toPublicServiceReport(report);
  }

  async findByIdOrThrow(id: string): Promise<ServiceReport> {
    const report = await this.prisma.serviceReport.findUnique({ where: { id } });
    if (!report) throw new NotFoundException("Service Report not found");
    return report;
  }

  // No @Permissions() on the route this backs — PermissionsGuard only ANDs
  // a fixed permission list, it has no "read OR read_own" concept (same D4
  // precedent as WorkOrdersService.getForActor). service_reports.read
  // always wins full access; service_reports.read_own wins only when the
  // caller is this report's own uploader; anyone with neither gets 403.
  // Enforced here against the database, never inferred from anything the
  // UI did or didn't show, and never bypassable by calling the API
  // directly with a known id.
  async getForActor(id: string, actor: ActorContext): Promise<PublicServiceReport> {
    const report = await this.findByIdOrThrow(id);
    const granted = new Set((await this.permissions.getEffectivePermissions(actor.userId)).map((p) => `${p.module}.${p.action}`));

    if (granted.has("service_reports.read")) return toPublicServiceReport(report);

    if (granted.has("service_reports.read_own")) {
      if (report.uploadedBy === actor.userId) return toPublicServiceReport(report);
      throw new ForbiddenException("You did not upload this Service Report");
    }

    throw new ForbiddenException("Missing required permission(s): service_reports.read or service_reports.read_own");
  }

  // GET /service-reports/mine — service_reports.read_own (guard-gated: this
  // route has nothing to branch on, unlike getForActor, since it's
  // exclusively a "my own uploads" view). Filters at the query itself, not
  // in application code after a broader fetch.
  async listForUploader(uploaderId: string): Promise<PublicServiceReport[]> {
    const reports = await this.prisma.serviceReport.findMany({
      where: { uploadedBy: uploaderId },
      orderBy: { uploadedAt: "desc" },
    });
    return reports.map(toPublicServiceReport);
  }

  // GET /service-reports?status=... — Phase 5 Step 5 (Human Verification
  // Workflow) addition, gated by the existing service_reports.read
  // permission (unscoped, same as getForActor's "read" branch) — this is
  // what makes a verifier's queue of PENDING_VERIFICATION reports
  // discoverable at all through the UI, rather than requiring a known id.
  // No new permission needed; no canonical/staging table touched.
  async listByStatus(statuses: ServiceReportStatus[]): Promise<PublicServiceReport[]> {
    const reports = await this.prisma.serviceReport.findMany({
      where: { status: { in: statuses } },
      orderBy: { uploadedAt: "asc" },
    });
    return reports.map(toPublicServiceReport);
  }

  // Phase 4 Operations Frontend (approved Decision 1) — the second of the
  // two new minimal endpoints: lets a Work Order detail screen show its
  // linked Service Reports without duplicating anything about how those
  // reports themselves are extracted/verified/confirmed/locked (that
  // remains entirely Phase 5's own frozen pipeline — this only lists rows
  // already carrying this workOrderId, exactly as service_reports.read
  // already permits reading them one at a time via GET /service-reports/:id).
  async listByWorkOrder(workOrderId: string): Promise<PublicServiceReport[]> {
    const reports = await this.prisma.serviceReport.findMany({
      where: { workOrderId },
      orderBy: { uploadedAt: "desc" },
    });
    return reports.map(toPublicServiceReport);
  }

  /**
   * Phase 4 Operations Frontend (user-approved follow-up to Decision 1) —
   * the third minimal new endpoint. There was previously no way for any
   * caller to discover valid reportTypeCode values for the upload DTO
   * (assertReportTypeActive below only ever validates a caller-supplied
   * code, never lists them) — apps/field's technician upload form needs a
   * real dropdown, not a hardcoded guess at what's currently seeded. Gated
   * on service_reports.upload (not a new permission — the same grant that
   * makes this list relevant to the caller in the first place), and
   * ACTIVE-only, matching what assertReportTypeActive would actually accept
   * if the caller then submitted that code.
   */
  async listActiveReportTypes() {
    return this.prisma.serviceReportType.findMany({
      where: { status: ReferenceStatus.ACTIVE },
      select: { code: true, label: true, sortOrder: true },
      orderBy: { sortOrder: "asc" },
    });
  }

  private async assertCustomerExists(customerId: string) {
    const exists = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!exists) throw new NotFoundException("Customer not found");
  }

  private async assertSiteValid(customerId: string, siteId: string) {
    const site = await this.prisma.site.findUnique({ where: { id: siteId }, select: { id: true, customerId: true } });
    if (!site) throw new NotFoundException("Site not found");
    if (site.customerId !== customerId) {
      throw new BadRequestException("Site must belong to the same customer as this Service Report");
    }
  }

  private async assertReportTypeActive(code: string) {
    const type = await this.prisma.serviceReportType.findUnique({ where: { code }, select: { status: true } });
    if (!type || type.status !== ReferenceStatus.ACTIVE) {
      throw new BadRequestException(`Invalid or inactive report type: ${code}`);
    }
  }

  // Work-order linkage (approved requirement): the Work Order must belong
  // to the same customer and site as the Service Report being uploaded —
  // same "belongs to" consistency check as assertSiteValid, one level up.
  private async assertWorkOrderValid(workOrderId: string, customerId: string, siteId: string): Promise<string> {
    const workOrder = await this.prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: { id: true, customerId: true, siteId: true },
    });
    if (!workOrder) throw new NotFoundException("Work Order not found");
    if (workOrder.customerId !== customerId || workOrder.siteId !== siteId) {
      throw new BadRequestException("Work Order must belong to the same customer and site as this Service Report");
    }
    return workOrder.id;
  }
}
