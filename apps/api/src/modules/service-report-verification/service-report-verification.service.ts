import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ActorType, ExtractionConfidence, ExtractionReviewStatus, ServiceReportStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { STORAGE_PROVIDER, StorageProvider } from "../../common/storage/storage-provider.interface";
import { SubmitFieldReviewDto } from "./dto/submit-field-review.dto";
import { STAGING_CATEGORIES, StagingCategory } from "./staging-category";

export interface ActorContext {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * The shared shape across all six extraction_* tables that this service
 * actually touches — measurement's three extra columns (aiUnit, stage,
 * suggestedMeasurementTypeCode) are read where present but never required,
 * same generic-delegate approach as StagingWriterService.
 */
interface VerifiableStagingRow {
  id: string;
  serviceReportId: string;
  rowIndex: number;
  fieldName: string;
  aiValue: string | null;
  aiConfidence: ExtractionConfidence | null;
  requiresHumanVerification: boolean;
  reviewStatus: ExtractionReviewStatus | null;
  verifiedValue: string | null;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  aiUnit?: string | null;
  suggestedMeasurementTypeCode?: string | null;
  stage?: string | null;
}

interface VerifiableStagingDelegate {
  findFirst(args: { where: { id: string; serviceReportId: string } }): Promise<VerifiableStagingRow | null>;
  findMany(args: { where: { serviceReportId: string }; orderBy?: unknown }): Promise<VerifiableStagingRow[]>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<VerifiableStagingRow>;
  count(args: { where: Record<string, unknown> }): Promise<number>;
  updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
}

export interface StagedFieldView {
  id: string;
  category: StagingCategory;
  rowIndex: number;
  fieldName: string;
  aiValue: string | null;
  aiUnit: string | null;
  aiConfidence: ExtractionConfidence | null;
  suggestedMeasurementTypeCode: string | null;
  stage: string | null;
  requiresHumanVerification: boolean;
  reviewStatus: ExtractionReviewStatus | null;
  verifiedValue: string | null;
  verifiedBy: string | null;
  verifiedAt: Date | null;
}

export interface VerificationView {
  report: {
    id: string;
    status: ServiceReportStatus;
    reportTypeCode: string;
    documentFileName: string;
    documentMimeType: string;
    uploadedBy: string | null;
    uploadedAt: Date;
    verifiedBy: string | null;
    verifiedAt: Date | null;
  };
  documentUrl: string;
  fields: Record<StagingCategory, StagedFieldView[]>;
}

export interface BulkConfirmPreview {
  eligibleCount: number;
  eligibleFields: Array<{ category: StagingCategory; id: string; fieldName: string; aiValue: string | null }>;
}

@Injectable()
export class ServiceReportVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly audit: AuditService,
  ) {}

  // this.prisma — never OcrWorkerPrismaService — per the Step 1 policy
  // record: reviewStatus/verifiedValue/verifiedBy/verifiedAt are written
  // only by app_runtime, never ocr_worker. app_runtime already has full DML
  // on all six extraction_* tables (grant-runtime-privileges.sql), so no
  // grant change was needed for this module.
  private delegateFor(category: StagingCategory): VerifiableStagingDelegate {
    switch (category) {
      case "basicInfo":
        return this.prisma.extractionBasicInfo as unknown as VerifiableStagingDelegate;
      case "equipmentUnit":
        return this.prisma.extractionEquipmentUnit as unknown as VerifiableStagingDelegate;
      case "problem":
        return this.prisma.extractionProblem as unknown as VerifiableStagingDelegate;
      case "measurement":
        return this.prisma.extractionMeasurement as unknown as VerifiableStagingDelegate;
      case "narrativeItem":
        return this.prisma.extractionNarrativeItem as unknown as VerifiableStagingDelegate;
      case "signoff":
        return this.prisma.extractionSignoff as unknown as VerifiableStagingDelegate;
    }
  }

  private async findReportOrThrow(serviceReportId: string) {
    const report = await this.prisma.serviceReport.findUnique({ where: { id: serviceReportId } });
    if (!report) throw new NotFoundException("Service Report not found");
    return report;
  }

  private assertPendingVerification(report: { status: ServiceReportStatus }): void {
    if (report.status !== ServiceReportStatus.PENDING_VERIFICATION) {
      throw new BadRequestException(
        `Service Report is ${report.status}, not PENDING_VERIFICATION — verification actions are not available`,
      );
    }
  }

  private toFieldView(category: StagingCategory, row: VerifiableStagingRow): StagedFieldView {
    return {
      id: row.id,
      category,
      rowIndex: row.rowIndex,
      fieldName: row.fieldName,
      aiValue: row.aiValue,
      aiUnit: row.aiUnit ?? null,
      aiConfidence: row.aiConfidence,
      suggestedMeasurementTypeCode: row.suggestedMeasurementTypeCode ?? null,
      stage: row.stage ?? null,
      requiresHumanVerification: row.requiresHumanVerification,
      reviewStatus: row.reviewStatus,
      verifiedValue: row.verifiedValue,
      verifiedBy: row.verifiedBy,
      verifiedAt: row.verifiedAt,
    };
  }

  /**
   * GET view — available regardless of report status (a verifier or anyone
   * with service_reports.verify may look at a VERIFIED/CONFIRMED report's
   * history too), but mutation methods below all require
   * PENDING_VERIFICATION.
   */
  async getVerificationView(serviceReportId: string): Promise<VerificationView> {
    const report = await this.findReportOrThrow(serviceReportId);
    const documentUrl = await this.storage.getSignedUrl(report.documentFileKey);

    const entries = await Promise.all(
      STAGING_CATEGORIES.map(async (category) => {
        const rows = await this.delegateFor(category).findMany({
          where: { serviceReportId },
          orderBy: [{ rowIndex: "asc" }, { fieldName: "asc" }],
        });
        return [category, rows.map((row) => this.toFieldView(category, row))] as const;
      }),
    );

    return {
      report: {
        id: report.id,
        status: report.status,
        reportTypeCode: report.reportTypeCode,
        documentFileName: report.documentFileName,
        documentMimeType: report.documentMimeType,
        uploadedBy: report.uploadedBy,
        uploadedAt: report.uploadedAt,
        verifiedBy: report.verifiedBy,
        verifiedAt: report.verifiedAt,
      },
      documentUrl,
      fields: Object.fromEntries(entries) as Record<StagingCategory, StagedFieldView[]>,
    };
  }

  /**
   * One field's explicit review decision. Never writes aiValue/aiConfidence/
   * aiUnit/suggestedMeasurementTypeCode — those columns are simply absent
   * from every `data` object in this method, so they cannot be touched
   * regardless of what the caller submits (immutability is structural, not
   * a runtime check that could be bypassed).
   */
  async submitFieldReview(
    serviceReportId: string,
    category: StagingCategory,
    rowId: string,
    dto: SubmitFieldReviewDto,
    actor: ActorContext,
  ): Promise<StagedFieldView> {
    const report = await this.findReportOrThrow(serviceReportId);
    this.assertPendingVerification(report);

    const delegate = this.delegateFor(category);
    const row = await delegate.findFirst({ where: { id: rowId, serviceReportId } });
    if (!row) throw new NotFoundException("Field not found on this Service Report");

    let verifiedValue: string | null;
    switch (dto.reviewStatus) {
      case ExtractionReviewStatus.CONFIRMED:
        // Reviewer agrees with the AI value as-is — copy it, never trust a
        // client-submitted value for this status (prevents a CONFIRMED
        // silently carrying a different value than what was actually
        // confirmed).
        verifiedValue = row.aiValue;
        break;
      case ExtractionReviewStatus.CORRECTED:
        if (dto.verifiedValue === undefined) {
          throw new BadRequestException("CORRECTED requires verifiedValue");
        }
        verifiedValue = dto.verifiedValue;
        break;
      case ExtractionReviewStatus.CONFIRMED_BLANK:
      case ExtractionReviewStatus.NEEDS_FOLLOW_UP:
        // Neither status asserts a value — blank/unreadable/N/A/zero stay
        // distinct via reviewStatus itself, never collapsed into a shared
        // "verifiedValue = null" with no further meaning.
        verifiedValue = null;
        break;
    }

    const updated = await delegate.update({
      where: { id: rowId },
      data: {
        reviewStatus: dto.reviewStatus,
        verifiedValue,
        verifiedBy: actor.userId,
        verifiedAt: new Date(),
      },
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "service_report_verification_field_reviewed",
      entityType: "ServiceReport",
      entityId: serviceReportId,
      afterData: {
        category,
        rowId,
        fieldName: row.fieldName,
        aiValue: row.aiValue,
        previousReviewStatus: row.reviewStatus,
        reviewStatus: dto.reviewStatus,
        verifiedValue,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return this.toFieldView(category, updated);
  }

  /**
   * Eligibility (approved Step 5 bulk-confirm rule, tightened per your
   * follow-up): has an AI value, confidence is HIGH or MEDIUM specifically
   * — LOW is no longer eligible, only UNREADABLE was excluded before this
   * change — was not flagged by the adaptive pipeline
   * (requiresHumanVerification === false), and has not already been
   * reviewed (reviewStatus IS NULL — this also structurally excludes
   * NEEDS_FOLLOW_UP, CORRECTED, and CONFIRMED rows, since all three already
   * carry a non-null reviewStatus). Blank fields (aiValue === null) are
   * excluded unconditionally — confirming a blank is always an explicit
   * per-field reviewer decision, never automatic. Single source of truth
   * used by both previewBulkConfirm and bulkConfirmEligibleFields so the
   * preview count can never drift from what the action actually applies.
   */
  private isEligibleForBulkConfirm(row: VerifiableStagingRow): boolean {
    return (
      row.aiValue !== null &&
      (row.aiConfidence === ExtractionConfidence.HIGH || row.aiConfidence === ExtractionConfidence.MEDIUM) &&
      !row.requiresHumanVerification &&
      row.reviewStatus === null
    );
  }

  async previewBulkConfirm(serviceReportId: string): Promise<BulkConfirmPreview> {
    const report = await this.findReportOrThrow(serviceReportId);
    this.assertPendingVerification(report);

    const perCategory = await Promise.all(
      STAGING_CATEGORIES.map(async (category) => {
        const rows = await this.delegateFor(category).findMany({ where: { serviceReportId } });
        const eligible = rows.filter((row) => this.isEligibleForBulkConfirm(row));
        return eligible.map((row) => ({ category, id: row.id, fieldName: row.fieldName, aiValue: row.aiValue }));
      }),
    );
    const eligibleFields = perCategory.flat();
    return { eligibleCount: eligibleFields.length, eligibleFields };
  }

  async bulkConfirmEligibleFields(serviceReportId: string, actor: ActorContext): Promise<{ confirmedCount: number; remainingAttentionCount: number }> {
    const report = await this.findReportOrThrow(serviceReportId);
    this.assertPendingVerification(report);

    const affected: Array<{ category: StagingCategory; id: string; fieldName: string; aiValue: string | null }> = [];
    const now = new Date();

    for (const category of STAGING_CATEGORIES) {
      const delegate = this.delegateFor(category);
      const rows = await delegate.findMany({ where: { serviceReportId } });
      const eligible = rows.filter((row) => this.isEligibleForBulkConfirm(row));
      for (const row of eligible) {
        await delegate.update({
          where: { id: row.id },
          data: {
            reviewStatus: ExtractionReviewStatus.CONFIRMED,
            verifiedValue: row.aiValue,
            verifiedBy: actor.userId,
            verifiedAt: now,
          },
        });
        affected.push({ category, id: row.id, fieldName: row.fieldName, aiValue: row.aiValue });
      }
    }

    // One audit entry for the whole bulk action, carrying a complete
    // per-field listing (category, row id, field name, the value each was
    // confirmed with) — full traceability without one audit row per field.
    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "service_report_verification_bulk_confirmed",
      entityType: "ServiceReport",
      entityId: serviceReportId,
      afterData: { confirmedCount: affected.length, fields: affected },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    const remainingAttentionCount = await this.countUnreviewed(serviceReportId);
    return { confirmedCount: affected.length, remainingAttentionCount };
  }

  private async countUnreviewed(serviceReportId: string): Promise<number> {
    const counts = await Promise.all(
      STAGING_CATEGORIES.map((category) => this.delegateFor(category).count({ where: { serviceReportId, reviewStatus: null } })),
    );
    return counts.reduce((sum, n) => sum + n, 0);
  }

  private async countNeedsFollowUp(serviceReportId: string): Promise<number> {
    const counts = await Promise.all(
      STAGING_CATEGORIES.map((category) =>
        this.delegateFor(category).count({ where: { serviceReportId, reviewStatus: ExtractionReviewStatus.NEEDS_FOLLOW_UP } }),
      ),
    );
    return counts.reduce((sum, n) => sum + n, 0);
  }

  /**
   * PENDING_VERIFICATION -> VERIFIED. Completeness rule (approved Step 5
   * decision): every staging row across all six tables must carry a
   * non-null reviewStatus — NOT that every field must have a non-blank
   * value, since many legitimate AgileWorks reports have intentionally
   * blank technical-data sections. A report containing any
   * NEEDS_FOLLOW_UP field is blocked from VERIFIED until every such field
   * is resolved into CONFIRMED, CORRECTED, or CONFIRMED_BLANK — no
   * intermediate "VERIFIED_WITH_EXCEPTION" status is introduced.
   */
  async completeVerification(serviceReportId: string, actor: ActorContext) {
    const report = await this.findReportOrThrow(serviceReportId);
    this.assertPendingVerification(report);

    const unreviewedCount = await this.countUnreviewed(serviceReportId);
    if (unreviewedCount > 0) {
      throw new BadRequestException(`${unreviewedCount} field(s) still require review before this report can be verified`);
    }

    const needsFollowUpCount = await this.countNeedsFollowUp(serviceReportId);
    if (needsFollowUpCount > 0) {
      throw new BadRequestException(
        `${needsFollowUpCount} field(s) are flagged NEEDS_FOLLOW_UP — resolve them into CONFIRMED, CORRECTED, or CONFIRMED_BLANK before this report can be verified`,
      );
    }

    const updated = await this.prisma.serviceReport.update({
      where: { id: serviceReportId },
      data: { status: ServiceReportStatus.VERIFIED, verifiedBy: actor.userId, verifiedAt: new Date() },
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "service_report_verified",
      entityType: "ServiceReport",
      entityId: serviceReportId,
      afterData: { previousStatus: ServiceReportStatus.PENDING_VERIFICATION, status: ServiceReportStatus.VERIFIED },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return updated;
  }
}
