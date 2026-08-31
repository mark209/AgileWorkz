import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  ActorType,
  InquiryStatus,
  NumberSeries,
  Prisma,
  QuotationRevisionStatus,
  QuotationTermTemplate,
  QuotationType,
  ReferenceStatus,
  TaxTreatment,
} from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { NumberingService } from "../../common/numbering/numbering.service";
import { ActorContext } from "../identity/users.service";
import { changedKeysOf, pickDefined } from "../../common/diff-fields.util";
import { assertRevisionEditable } from "./revision-lock.util";
import { isOverApprovalThreshold } from "./quotation-approval-threshold.util";
import { QuotationPricingService } from "./pricing/quotation-pricing.service";
import { round2 } from "./pricing/revision-pricing.util";
import { CreateQuotationDto } from "./dto/create-quotation.dto";
import { ConvertInquiryToQuotationDto } from "./dto/convert-inquiry-to-quotation.dto";
import { UpdateRevisionContentDto } from "./dto/update-revision-content.dto";
import { RejectRevisionDto } from "./dto/reject-revision.dto";
import { RecordDecisionDto } from "./dto/record-decision.dto";
import { ExpireRevisionDto } from "./dto/expire-revision.dto";

// Terminal revision states — creating Revision N+1 never overwrites one of
// these back to SUPERSEDED (§05/§10: "unless it already reached a terminal
// state"). ACCEPTED is deliberately NOT in this list: it is handled as its
// own, stricter case (C6) that blocks new-revision creation entirely rather
// than just being preserved.
const TERMINAL_NON_ACCEPTED_STATUSES: QuotationRevisionStatus[] = [
  QuotationRevisionStatus.REJECTED,
  QuotationRevisionStatus.DECLINED,
  QuotationRevisionStatus.EXPIRED,
];

const DEFAULT_TAX_TREATMENT_FALLBACK = TaxTreatment.VAT_INCLUSIVE;
const DEFAULT_VAT_RATE_FALLBACK = "12";

// Step 7 — same live-system_settings-with-fallback pattern as
// resolveVatRatePercent. Fallbacks match the actual seeded Phase 1 values,
// used only if the setting row is somehow missing.
const DEFAULT_APPROVAL_THRESHOLD_PHP_FALLBACK = "50000";
const DEFAULT_DISCOUNT_THRESHOLD_PCT_FALLBACK = "10";

// The exact literal seeded onto the placeholder QuotationTermTemplate (see
// seed.ts DEFAULT_QUOTATION_TERM_TEMPLATE_BODY). Deliberately a simple
// substring check on the copied termsAndConditions text — the placeholder
// marker travels with the copied text through Revision 0 and every
// copy-forward revision, so this check works regardless of how many
// revisions removed a quotation is from its original template.
const PLACEHOLDER_TC_MARKER = "[PLACEHOLDER";

// The shared shape both creation paths reduce to before calling
// createQuotationAndRevision0 — see the module comment on that method for
// why this exists (Step 5: "do not duplicate quotation creation logic
// between the routes").
interface Revision0Content {
  quotationType: QuotationType;
  primaryTradeCode: string;
  scopeOfWork?: string;
  defaultTaxTreatment?: TaxTreatment;
  paymentTerms?: string;
  warranty?: string;
  leadTime?: string;
  notes?: string;
  exclusions?: string;
  validUntil?: string;
}

@Injectable()
export class QuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly pricing: QuotationPricingService,
  ) {}

  async findByIdOrThrow(id: string) {
    const quotation = await this.prisma.quotation.findUnique({ where: { id } });
    if (!quotation) throw new NotFoundException("Quotation not found");
    return quotation;
  }

  async listForCustomer(customerId: string) {
    await this.assertCustomerExists(customerId);
    return this.prisma.quotation.findMany({ where: { customerId }, orderBy: { createdAt: "desc" } });
  }

  /**
   * Phase 6 (Dashboard) addition — global, cross-customer listing, optionally
   * filtered by status. Mirrors the exact shape/precedent already approved
   * for ServiceReportsService.listByStatus (Phase 5 Step 5): no new
   * permission (gated on the existing quotations.read at the controller),
   * no aggregate table, no new relationship. `statuses` undefined/empty
   * returns every quotation, matching this module's own listForCustomer
   * (no implicit status filter) rather than service-reports' own
   * queue-specific default.
   */
  async listAllOrByStatus(statuses?: QuotationRevisionStatus[]) {
    return this.prisma.quotation.findMany({
      where: statuses && statuses.length > 0 ? { status: { in: statuses } } : undefined,
      orderBy: { createdAt: "desc" },
    });
  }

  async listRevisions(quotationId: string) {
    await this.findByIdOrThrow(quotationId);
    return this.prisma.quotationRevision.findMany({
      where: { quotationId },
      orderBy: { revisionNumber: "asc" },
    });
  }

  async findRevisionOrThrow(quotationId: string, revisionId: string) {
    await this.findByIdOrThrow(quotationId);
    const revision = await this.prisma.quotationRevision.findUnique({ where: { id: revisionId } });
    if (!revision || revision.quotationId !== quotationId) {
      throw new NotFoundException("Quotation revision not found");
    }
    return revision;
  }

  // PATCH .../revisions/:revisionId — DRAFT-only, per assertRevisionEditable.
  // C4: discountPercent/discountAmount are mutually exclusive; whichever is
  // sent is authoritative and the other is derived from the CURRENT
  // subtotal at that moment. From then on, discount_amount is the anchor
  // that ordinary line-item recalculation reconciles against (see
  // QuotationPricingService / revision-pricing.util.ts) — discount_percent
  // is a derived display value that tracks it, not the other way around.
  async updateRevisionContent(revisionId: string, dto: UpdateRevisionContentDto, actor: ActorContext) {
    if (dto.discountPercent !== undefined && dto.discountAmount !== undefined) {
      throw new BadRequestException("Provide either discountPercent or discountAmount, never both in the same request");
    }
    const before = await this.findRevisionByIdOrThrow(revisionId);
    assertRevisionEditable(before);

    const changedKeys = changedKeysOf(dto);
    const after = await this.prisma.$transaction(async (tx) => {
      let discountAmountOverride: Prisma.Decimal | undefined;
      if (dto.discountAmount !== undefined) {
        discountAmountOverride = round2(dto.discountAmount);
      } else if (dto.discountPercent !== undefined) {
        discountAmountOverride = round2(before.subtotal.times(dto.discountPercent).dividedBy(100));
      }

      await tx.quotationRevision.update({
        where: { id: revisionId },
        data: {
          scopeOfWork: dto.scopeOfWork,
          paymentTerms: dto.paymentTerms,
          warranty: dto.warranty,
          leadTime: dto.leadTime,
          notes: dto.notes,
          exclusions: dto.exclusions,
          termsAndConditions: dto.termsAndConditions,
          validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
          defaultTaxTreatment: dto.defaultTaxTreatment,
          discountAmount: discountAmountOverride,
        },
      });

      // Only line-item/discount-affecting changes need a recalculation —
      // pure free-text edits (notes, warranty, etc.) don't touch pricing.
      if (discountAmountOverride !== undefined) {
        await this.pricing.recalculate(tx, revisionId);
      }

      return tx.quotationRevision.findUniqueOrThrow({ where: { id: revisionId } });
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "revision_updated",
      entityType: "quotation_revision",
      entityId: revisionId,
      beforeData: pickDefined(before, changedKeys),
      afterData: pickDefined(after, changedKeys),
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  // POST /quotations/:id/revisions — Revision N+1, a complete copy-forward.
  // C6: explicitly rejects an ACCEPTED current revision — accepted
  // quotations are commercially frozen for V1; future post-acceptance
  // change requests belong to a separate, not-yet-built Variation/Change
  // Order workflow, not another quotation revision.
  async createNextRevision(quotationId: string, actor: ActorContext) {
    await this.findByIdOrThrow(quotationId);
    const current = await this.prisma.quotationRevision.findFirst({ where: { quotationId, isCurrent: true } });
    if (!current) throw new NotFoundException("This quotation has no current revision");
    if (current.status === QuotationRevisionStatus.ACCEPTED) {
      throw new BadRequestException(
        "This quotation's current revision is ACCEPTED — accepted quotations are commercially frozen for V1. " +
          "Post-acceptance changes belong to a future Variation/Change Order workflow, not a new quotation revision.",
      );
    }

    const wasTerminal = TERMINAL_NON_ACCEPTED_STATUSES.includes(current.status);

    const { next } = await this.prisma.$transaction(async (tx) => {
      const vatRatePercent = await this.resolveVatRatePercent(tx); // C2: re-snapshot, never copied

      await tx.quotationRevision.update({
        where: { id: current.id },
        data: {
          isCurrent: false,
          status: wasTerminal ? current.status : QuotationRevisionStatus.SUPERSEDED,
        },
      });

      const newRevision = await tx.quotationRevision.create({
        data: {
          quotationId,
          revisionNumber: current.revisionNumber + 1,
          isCurrent: true,
          status: QuotationRevisionStatus.DRAFT,
          scopeOfWork: current.scopeOfWork,
          defaultTaxTreatment: current.defaultTaxTreatment, // C3: copied forward, not re-resolved
          vatRatePercent,
          // Copied as the starting anchor; QuotationPricingService.recalculate()
          // below clamps/reconciles it against the freshly copied (and
          // possibly re-priced, since the VAT rate may differ) line set.
          discountAmount: current.discountAmount,
          paymentTerms: current.paymentTerms,
          warranty: current.warranty,
          leadTime: current.leadTime,
          notes: current.notes,
          exclusions: current.exclusions,
          termsAndConditions: current.termsAndConditions, // exactly as edited — no re-templating
          validUntil: current.validUntil,
          createdBy: actor.userId,
        },
      });

      const oldSections = await tx.quotationSection.findMany({ where: { quotationRevisionId: current.id } });
      const sectionIdMap = new Map<string, string>();
      for (const section of oldSections) {
        const copy = await tx.quotationSection.create({
          data: {
            quotationRevisionId: newRevision.id,
            name: section.name,
            tradeCode: section.tradeCode,
            sortOrder: section.sortOrder,
          },
        });
        sectionIdMap.set(section.id, copy.id);
      }

      const oldLines = await tx.quotationLineItem.findMany({ where: { quotationRevisionId: current.id } });
      for (const line of oldLines) {
        await tx.quotationLineItem.create({
          data: {
            quotationRevisionId: newRevision.id,
            sectionId: line.sectionId ? sectionIdMap.get(line.sectionId) : null,
            assetId: line.assetId,
            description: line.description,
            specification: line.specification,
            brand: line.brand,
            model: line.model,
            quantity: line.quantity,
            unit: line.unit,
            unitCostExpense: line.unitCostExpense,
            markupPercent: line.markupPercent,
            unitPriceBeforeVat: line.unitPriceBeforeVat,
            taxTreatment: line.taxTreatment,
            materialAmount: line.materialAmount,
            laborAmount: line.laborAmount,
            unitPrice: 0,
            lineAmount: 0,
            lineFinalAmount: 0,
            lineNetAmount: 0,
            lineVatAmount: 0,
            sortOrder: line.sortOrder,
          },
        });
      }

      const oldMaintenance = await tx.quotationMaintenanceDetails.findUnique({
        where: { quotationRevisionId: current.id },
      });
      if (oldMaintenance) {
        await tx.quotationMaintenanceDetails.create({
          data: {
            quotationRevisionId: newRevision.id,
            contractPeriodMonths: oldMaintenance.contractPeriodMonths,
            frequency: oldMaintenance.frequency,
            scheduledVisits: oldMaintenance.scheduledVisits,
            billingFrequency: oldMaintenance.billingFrequency,
          },
        });
      }

      const oldItems = await tx.quotationTestingCommissioningItem.findMany({
        where: { quotationRevisionId: current.id },
      });
      for (const item of oldItems) {
        await tx.quotationTestingCommissioningItem.create({
          data: {
            quotationRevisionId: newRevision.id,
            description: item.description,
            included: item.included,
            sortOrder: item.sortOrder,
          },
        });
      }

      // Recomputes every derived field on the freshly-copied lines/sections
      // and reconciles discount_amount/discount_percent/totals against the
      // (possibly re-priced, since VAT rate may have changed) new set —
      // the source revision itself is never touched by any of this.
      await this.pricing.recalculate(tx, newRevision.id);

      await tx.quotation.update({ where: { id: quotationId }, data: { status: QuotationRevisionStatus.DRAFT } });

      return { next: await tx.quotationRevision.findUniqueOrThrow({ where: { id: newRevision.id } }) };
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "revision_created",
      entityType: "quotation_revision",
      entityId: next.id,
      afterData: {
        quotationId,
        revisionNumber: next.revisionNumber,
        copiedFromRevisionId: current.id,
        defaultTaxTreatment: next.defaultTaxTreatment,
        vatRatePercent: next.vatRatePercent.toString(),
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    if (!wasTerminal) {
      await this.audit.write({
        actorType: ActorType.USER,
        actorUserId: actor.userId,
        action: "revision_superseded",
        entityType: "quotation_revision",
        entityId: current.id,
        beforeData: { status: current.status },
        afterData: { status: "SUPERSEDED", supersededByRevisionId: next.id },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    }

    return next;
  }

  // ---------------------------------------------------------------------
  // Step 7 — Approval / Submission / Rejection / Send / Decision Workflow.
  //
  // State machine (approved plan §09/§10, reaffirmed in the Step 7 review):
  //   DRAFT --submit--> APPROVED (auto, under both thresholds)
  //   DRAFT --submit--> PENDING_APPROVAL (over either threshold)
  //   PENDING_APPROVAL --approve--> APPROVED
  //   PENDING_APPROVAL --reject--> REJECTED (terminal)
  //   APPROVED --send--> SENT
  //   SENT --decision(ACCEPTED)--> ACCEPTED (terminal)
  //   SENT --decision(DECLINED)--> DECLINED (terminal)
  //   SENT --expire--> EXPIRED (terminal)
  //
  // Every transition below enforces its own "from" status as an atomic
  // updateMany(where: {id, status: EXPECTED}) guard, not just a preceding
  // read-then-branch check — this is what makes concurrent transition
  // attempts on the same revision safe (a losing racer gets a 409, not a
  // corrupted double-transition), the same pattern already used for the
  // Inquiry->Quotation conversion race guard in createFromInquiry above.
  // By construction, no method here accepts ACCEPTED (or any other
  // terminal status) as a valid "from" state, so an ACCEPTED revision can
  // never be reopened or mutated by anything in this block (verified
  // requirement #11 of the Step 7 review).
  // ---------------------------------------------------------------------

  // PATCH .../revisions/:revisionId/submit — quotations.update.
  // C7: blocks submission with zero line items. Threshold comparison per
  // the Rev 7 blueprint's original wording: "<= threshold = standard,
  // above = requires approval" — so `<=` on both dimensions auto-approves,
  // `>` on either requires PENDING_APPROVAL. C2: auto-approval sets
  // approvedAt (a true "when did this become approved" fact) but leaves
  // approvedBy null (no human approved it) and does NOT write a separate
  // revision_approved audit event — the revision_submitted payload below
  // is the complete, sufficient record of the auto-approval decision.
  async submitRevision(revisionId: string, actor: ActorContext) {
    const before = await this.findRevisionByIdOrThrow(revisionId);
    if (before.status !== QuotationRevisionStatus.DRAFT) {
      throw new BadRequestException(
        `Only a DRAFT revision can be submitted for approval — this revision is ${before.status}`,
      );
    }

    const lineItemCount = await this.prisma.quotationLineItem.count({
      where: { quotationRevisionId: revisionId },
    });
    if (lineItemCount === 0) {
      throw new BadRequestException(
        "This revision has no line items — add at least one before submitting it for approval",
      );
    }

    const { after, autoApproved, approvalThresholdPhp, discountThresholdPct } = await this.prisma.$transaction(
      async (tx) => {
        const approvalThresholdPhp = await this.resolveApprovalThresholdPhp(tx);
        const discountThresholdPct = await this.resolveDiscountThresholdPct(tx);

        const overThreshold = isOverApprovalThreshold(
          before.totalAmount,
          before.discountPercent,
          approvalThresholdPhp,
          discountThresholdPct,
        );
        const autoApproved = !overThreshold;
        const resultingStatus = autoApproved
          ? QuotationRevisionStatus.APPROVED
          : QuotationRevisionStatus.PENDING_APPROVAL;

        const guarded = await tx.quotationRevision.updateMany({
          where: { id: revisionId, status: QuotationRevisionStatus.DRAFT },
          data: {
            submittedAt: new Date(),
            status: resultingStatus,
            approvedAt: autoApproved ? new Date() : undefined,
          },
        });
        if (guarded.count === 0) {
          throw new ConflictException(
            "This revision is no longer DRAFT — it may have just been submitted by someone else",
          );
        }

        await tx.quotation.update({ where: { id: before.quotationId }, data: { status: resultingStatus } });
        const after = await tx.quotationRevision.findUniqueOrThrow({ where: { id: revisionId } });
        return { after, autoApproved, approvalThresholdPhp, discountThresholdPct };
      },
    );

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "revision_submitted",
      entityType: "quotation_revision",
      entityId: revisionId,
      beforeData: { status: before.status },
      afterData: {
        status: after.status,
        autoApproved,
        totalAmount: after.totalAmount.toString(),
        discountPercent: after.discountPercent.toString(),
        approvalThresholdPhp,
        discountThresholdPct,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  // PATCH .../revisions/:revisionId/approve — quotations.approve
  // (Admin/Owner, Manager only). Only valid from PENDING_APPROVAL — the
  // explicit, human-judgment resolution of the approval gate, distinct from
  // submitRevision's own auto-approve path above. C1: approvedBy IS
  // populated here, since this is exactly the explicit human action that
  // column name describes.
  async approveRevision(revisionId: string, actor: ActorContext) {
    const before = await this.findRevisionByIdOrThrow(revisionId);
    if (before.status !== QuotationRevisionStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        `Only a PENDING_APPROVAL revision can be approved — this revision is ${before.status}`,
      );
    }

    const { after, approvalThresholdPhp, discountThresholdPct } = await this.prisma.$transaction(async (tx) => {
      const approvalThresholdPhp = await this.resolveApprovalThresholdPhp(tx);
      const discountThresholdPct = await this.resolveDiscountThresholdPct(tx);

      const guarded = await tx.quotationRevision.updateMany({
        where: { id: revisionId, status: QuotationRevisionStatus.PENDING_APPROVAL },
        data: { approvedBy: actor.userId, approvedAt: new Date(), status: QuotationRevisionStatus.APPROVED },
      });
      if (guarded.count === 0) {
        throw new ConflictException(
          "This revision is no longer PENDING_APPROVAL — it may have just been actioned by someone else",
        );
      }

      await tx.quotation.update({
        where: { id: before.quotationId },
        data: { status: QuotationRevisionStatus.APPROVED },
      });
      const after = await tx.quotationRevision.findUniqueOrThrow({ where: { id: revisionId } });
      return { after, approvalThresholdPhp, discountThresholdPct };
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "revision_approved",
      entityType: "quotation_revision",
      entityId: revisionId,
      beforeData: { status: before.status },
      afterData: {
        status: after.status,
        totalAmount: after.totalAmount.toString(),
        discountPercent: after.discountPercent.toString(),
        approvalThresholdPhp,
        discountThresholdPct,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  // PATCH .../revisions/:revisionId/reject — quotations.reject (Admin/Owner,
  // Manager only). REJECTED = internally rejected during the AgileWorks
  // approval workflow, before the customer ever saw it — distinct from
  // DECLINED, the customer's own decision after SENT (recordRevisionDecision
  // below). Reason is mandatory (C6). C1: approvedBy/approvedAt are
  // deliberately left untouched — nobody approved this revision; the
  // rejecting actor is recoverable from this audit entry.
  async rejectRevision(revisionId: string, dto: RejectRevisionDto, actor: ActorContext) {
    if (!dto.reason?.trim()) {
      throw new BadRequestException("A reason is required to reject a revision");
    }
    const before = await this.findRevisionByIdOrThrow(revisionId);
    if (before.status !== QuotationRevisionStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        `Only a PENDING_APPROVAL revision can be rejected — this revision is ${before.status}`,
      );
    }

    const { after, approvalThresholdPhp, discountThresholdPct } = await this.prisma.$transaction(async (tx) => {
      const approvalThresholdPhp = await this.resolveApprovalThresholdPhp(tx);
      const discountThresholdPct = await this.resolveDiscountThresholdPct(tx);

      const guarded = await tx.quotationRevision.updateMany({
        where: { id: revisionId, status: QuotationRevisionStatus.PENDING_APPROVAL },
        data: { rejectedAt: new Date(), status: QuotationRevisionStatus.REJECTED },
      });
      if (guarded.count === 0) {
        throw new ConflictException(
          "This revision is no longer PENDING_APPROVAL — it may have just been actioned by someone else",
        );
      }

      await tx.quotation.update({
        where: { id: before.quotationId },
        data: { status: QuotationRevisionStatus.REJECTED },
      });
      const after = await tx.quotationRevision.findUniqueOrThrow({ where: { id: revisionId } });
      return { after, approvalThresholdPhp, discountThresholdPct };
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "revision_rejected",
      entityType: "quotation_revision",
      entityId: revisionId,
      beforeData: { status: before.status },
      afterData: {
        status: after.status,
        totalAmount: after.totalAmount.toString(),
        discountPercent: after.discountPercent.toString(),
        approvalThresholdPhp,
        discountThresholdPct,
      },
      reason: dto.reason,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  // PATCH .../revisions/:revisionId/send — quotations.update. Only valid
  // from APPROVED. Enforces the standing placeholder-T&C guard (Step 3
  // correction instruction): a revision whose terms_and_conditions still
  // carries the seeded placeholder marker text must never be sent to a
  // customer. Internal submission/approval is deliberately NOT blocked by
  // this — only the customer-facing SEND moment is.
  async sendRevision(revisionId: string, actor: ActorContext) {
    const before = await this.findRevisionByIdOrThrow(revisionId);
    if (before.status !== QuotationRevisionStatus.APPROVED) {
      throw new BadRequestException(`Only an APPROVED revision can be sent — this revision is ${before.status}`);
    }
    if (before.termsAndConditions?.includes(PLACEHOLDER_TC_MARKER)) {
      throw new BadRequestException(
        "This revision's Terms & Conditions still contain placeholder content and cannot be sent to a customer. " +
          "Replace the placeholder T&C text before sending.",
      );
    }

    const after = await this.prisma.$transaction(async (tx) => {
      const guarded = await tx.quotationRevision.updateMany({
        where: { id: revisionId, status: QuotationRevisionStatus.APPROVED },
        data: { sentAt: new Date(), status: QuotationRevisionStatus.SENT },
      });
      if (guarded.count === 0) {
        throw new ConflictException(
          "This revision is no longer APPROVED — it may have just been actioned by someone else",
        );
      }

      await tx.quotation.update({ where: { id: before.quotationId }, data: { status: QuotationRevisionStatus.SENT } });
      return tx.quotationRevision.findUniqueOrThrow({ where: { id: revisionId } });
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "revision_sent",
      entityType: "quotation_revision",
      entityId: revisionId,
      beforeData: { status: before.status },
      afterData: { status: after.status, sentAt: after.sentAt },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  // PATCH .../revisions/:revisionId/decision — quotations.update. Only
  // valid from SENT. Records the CUSTOMER's own decision — ACCEPTED or
  // DECLINED — distinct from the internal REJECTED outcome above. Both
  // outcomes share the same customer_decision_at timestamp column; status
  // itself is what distinguishes which outcome occurred. reason is optional
  // for both (C6).
  async recordRevisionDecision(revisionId: string, dto: RecordDecisionDto, actor: ActorContext) {
    const before = await this.findRevisionByIdOrThrow(revisionId);
    if (before.status !== QuotationRevisionStatus.SENT) {
      throw new BadRequestException(
        `Only a SENT revision can have a customer decision recorded — this revision is ${before.status}`,
      );
    }

    const resultingStatus =
      dto.decision === "ACCEPTED" ? QuotationRevisionStatus.ACCEPTED : QuotationRevisionStatus.DECLINED;

    const after = await this.prisma.$transaction(async (tx) => {
      const guarded = await tx.quotationRevision.updateMany({
        where: { id: revisionId, status: QuotationRevisionStatus.SENT },
        data: { customerDecisionAt: new Date(), status: resultingStatus },
      });
      if (guarded.count === 0) {
        throw new ConflictException(
          "This revision is no longer SENT — it may have just been actioned by someone else",
        );
      }

      await tx.quotation.update({ where: { id: before.quotationId }, data: { status: resultingStatus } });
      return tx.quotationRevision.findUniqueOrThrow({ where: { id: revisionId } });
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "revision_decision_recorded",
      entityType: "quotation_revision",
      entityId: revisionId,
      beforeData: { status: before.status },
      afterData: { status: after.status, decision: dto.decision },
      reason: dto.reason ?? null,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  // PATCH .../revisions/:revisionId/expire — quotations.update. Manual-only
  // for V1 (C4) — only valid from SENT, not date-gated against validUntil
  // (C5, may fire before the stated deadline), reason mandatory (C5) as the
  // compensating record for why. The actual state mutation lives in
  // transitionRevisionToExpired() below specifically so a future scheduled
  // auto-expiry process (not built in this step) can call the same domain
  // logic for each eligible SENT-and-past-validUntil revision it finds,
  // instead of duplicating this transition.
  async expireRevision(revisionId: string, dto: ExpireRevisionDto, actor: ActorContext) {
    if (!dto.reason?.trim()) {
      throw new BadRequestException("A reason is required to mark a revision as expired");
    }
    const before = await this.findRevisionByIdOrThrow(revisionId);
    if (before.status !== QuotationRevisionStatus.SENT) {
      throw new BadRequestException(`Only a SENT revision can be marked expired — this revision is ${before.status}`);
    }

    const after = await this.prisma.$transaction((tx) =>
      this.transitionRevisionToExpired(tx, before.quotationId, revisionId),
    );

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "revision_expired",
      entityType: "quotation_revision",
      entityId: revisionId,
      beforeData: { status: before.status },
      afterData: {
        status: after.status,
        expiredAt: after.expiredAt,
        validUntil: after.validUntil,
      },
      reason: dto.reason,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  // Shared SENT -> EXPIRED domain transition (see expireRevision above).
  // Deliberately takes an already-open tx and returns the updated row
  // without writing an audit entry itself — the caller (manual endpoint
  // today, a future scheduler later) owns the actor/reason and therefore
  // the audit write.
  private async transitionRevisionToExpired(
    tx: Prisma.TransactionClient,
    quotationId: string,
    revisionId: string,
  ) {
    const guarded = await tx.quotationRevision.updateMany({
      where: { id: revisionId, status: QuotationRevisionStatus.SENT },
      data: { expiredAt: new Date(), status: QuotationRevisionStatus.EXPIRED },
    });
    if (guarded.count === 0) {
      throw new ConflictException("This revision is no longer SENT — it may have just been actioned by someone else");
    }
    await tx.quotation.update({ where: { id: quotationId }, data: { status: QuotationRevisionStatus.EXPIRED } });
    return tx.quotationRevision.findUniqueOrThrow({ where: { id: revisionId } });
  }

  private async resolveApprovalThresholdPhp(tx: Prisma.TransactionClient): Promise<string> {
    const setting = await tx.systemSetting.findUnique({ where: { key: "quotation_approval_threshold_php" } });
    return setting?.value ?? DEFAULT_APPROVAL_THRESHOLD_PHP_FALLBACK;
  }

  private async resolveDiscountThresholdPct(tx: Prisma.TransactionClient): Promise<string> {
    const setting = await tx.systemSetting.findUnique({ where: { key: "quotation_discount_threshold_pct" } });
    return setting?.value ?? DEFAULT_DISCOUNT_THRESHOLD_PCT_FALLBACK;
  }

  // Direct creation — POST /customers/:id/quotations.
  async create(customerId: string, dto: CreateQuotationDto, actor: ActorContext) {
    await this.assertCustomerExists(customerId);
    await this.assertSiteValid(customerId, dto.siteId);
    await this.assertTradeValid(dto.primaryTradeCode);

    const { quotation, revision, template } = await this.prisma.$transaction((tx) =>
      this.createQuotationAndRevision0(tx, {
        customerId,
        siteId: dto.siteId,
        inquiryId: null,
        customerReferenceNo: dto.customerReferenceNo,
        content: dto,
      }),
    );

    await this.writeCreationAudit(quotation, revision, template, actor);
    return quotation;
  }

  // Conversion — POST /inquiries/:id/quotations. The inquiry's flip to
  // CONVERTED and the quotation + Revision 0 insert happen in ONE
  // transaction: an optimistic status guard (updateMany WHERE status=OPEN)
  // means a second concurrent conversion attempt on the same inquiry can
  // never also succeed, and if anything in the transaction fails, the
  // inquiry is never left CONVERTED without a real quotation behind it —
  // Postgres rolls the whole transaction back, inquiry included.
  async createFromInquiry(inquiryId: string, dto: ConvertInquiryToQuotationDto, actor: ActorContext) {
    const inquiry = await this.prisma.inquiry.findUnique({ where: { id: inquiryId } });
    if (!inquiry) throw new NotFoundException("Inquiry not found");
    // Fast-path, friendly message for the common (non-race) case. The real
    // safety net against a concurrent conversion is the in-transaction
    // guard below, not this check.
    if (inquiry.status !== InquiryStatus.OPEN) {
      throw new ConflictException(`Inquiry is ${inquiry.status} — only an OPEN inquiry can be converted`);
    }

    await this.assertSiteValid(inquiry.customerId, dto.siteId);
    const primaryTradeCode = dto.primaryTradeCode ?? inquiry.tradeCode ?? undefined;
    if (!primaryTradeCode) {
      throw new BadRequestException(
        "primaryTradeCode is required — this inquiry has no tradeCode to fall back to",
      );
    }
    await this.assertTradeValid(primaryTradeCode);

    const { quotation, revision, template } = await this.prisma.$transaction(async (tx) => {
      const guarded = await tx.inquiry.updateMany({
        where: { id: inquiryId, status: InquiryStatus.OPEN },
        data: { status: InquiryStatus.CONVERTED, convertedAt: new Date() },
      });
      if (guarded.count === 0) {
        // Someone else converted or closed it between our read above and
        // this transaction. Throwing here rolls back the whole transaction
        // — no quotation number is consumed, nothing is half-created.
        throw new ConflictException("Inquiry is no longer OPEN — it may have just been converted or closed");
      }

      return this.createQuotationAndRevision0(tx, {
        customerId: inquiry.customerId,
        siteId: dto.siteId,
        inquiryId,
        customerReferenceNo: dto.customerReferenceNo ?? inquiry.customerReferenceNo ?? undefined,
        content: {
          ...dto,
          primaryTradeCode,
          scopeOfWork: dto.scopeOfWork ?? inquiry.description ?? inquiry.subject,
        },
      });
    });

    await this.writeCreationAudit(quotation, revision, template, actor);

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "inquiry_converted",
      entityType: "inquiry",
      entityId: inquiryId,
      beforeData: { status: InquiryStatus.OPEN },
      afterData: {
        status: InquiryStatus.CONVERTED,
        quotationId: quotation.id,
        quotationNumber: quotation.quotationNumber,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return quotation;
  }

  // The single shared core for both creation paths — numbering, tax-setting
  // resolution, template selection, and the quotation + Revision 0 insert
  // all happen here exactly once, called from inside each path's own
  // transaction. This is what "do not duplicate quotation creation logic
  // between the routes" means in code, not just in principle.
  private async createQuotationAndRevision0(
    tx: Prisma.TransactionClient,
    params: {
      customerId: string;
      siteId: string;
      inquiryId: string | null;
      customerReferenceNo?: string;
      content: Revision0Content;
    },
  ) {
    const quotationNumber = await this.numbering.generateNumber(tx, NumberSeries.QUOTATION);
    const defaultTaxTreatment = await this.resolveDefaultTaxTreatment(tx, params.content.defaultTaxTreatment);
    const vatRatePercent = await this.resolveVatRatePercent(tx);
    const template = await this.findBestTemplate(tx, params.content.quotationType, params.content.primaryTradeCode);

    const quotation = await tx.quotation.create({
      data: {
        customerId: params.customerId,
        siteId: params.siteId,
        inquiryId: params.inquiryId,
        quotationNumber,
        quotationType: params.content.quotationType,
        primaryTradeCode: params.content.primaryTradeCode,
        customerReferenceNo: params.customerReferenceNo,
      },
    });

    const revision = await tx.quotationRevision.create({
      data: {
        quotationId: quotation.id,
        revisionNumber: 0,
        isCurrent: true,
        scopeOfWork: params.content.scopeOfWork,
        defaultTaxTreatment,
        vatRatePercent,
        paymentTerms: params.content.paymentTerms,
        warranty: params.content.warranty,
        leadTime: params.content.leadTime,
        notes: params.content.notes,
        exclusions: params.content.exclusions,
        termsAndConditions: template?.body,
        validUntil: params.content.validUntil ? new Date(params.content.validUntil) : undefined,
      },
    });

    return { quotation, revision, template };
  }

  private async writeCreationAudit(
    quotation: {
      id: string;
      quotationNumber: string;
      customerId: string;
      quotationType: QuotationType;
      primaryTradeCode: string;
    },
    revision: { id: string; defaultTaxTreatment: TaxTreatment; vatRatePercent: Prisma.Decimal },
    template: QuotationTermTemplate | null,
    actor: ActorContext,
  ) {
    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "quotation_created",
      entityType: "quotation",
      entityId: quotation.id,
      afterData: {
        quotationNumber: quotation.quotationNumber,
        customerId: quotation.customerId,
        quotationType: quotation.quotationType,
        primaryTradeCode: quotation.primaryTradeCode,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "revision_created",
      entityType: "quotation_revision",
      entityId: revision.id,
      afterData: {
        quotationId: quotation.id,
        revisionNumber: 0,
        defaultTaxTreatment: revision.defaultTaxTreatment,
        vatRatePercent: revision.vatRatePercent.toString(),
        // Template traceability (Step 5 correction, decision 1): the copied
        // terms_and_conditions text has zero ongoing link back to its
        // template once copied (§08), so this audit entry is the only
        // durable record of which template supplied it — including whether
        // it was the placeholder fallback, so that's always traceable after
        // the fact, without a template FK on quotation_revisions.
        templateId: template?.id ?? null,
        templateName: template?.name ?? null,
        templateIsDefault: template?.isDefault ?? null,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }

  // Exact (quotationType, tradeCode) match -> type-only (tradeCode IS NULL)
  // -> global is_default fallback. Approved plan §08. May return null if
  // somehow no active template matches at all (the seeded is_default
  // placeholder means this shouldn't happen in practice, but nothing here
  // assumes it can't).
  private async findBestTemplate(
    tx: Prisma.TransactionClient,
    quotationType: QuotationType,
    tradeCode: string,
  ): Promise<QuotationTermTemplate | null> {
    const exact = await tx.quotationTermTemplate.findFirst({
      where: { status: ReferenceStatus.ACTIVE, quotationType, tradeCode },
      orderBy: { createdAt: "asc" },
    });
    if (exact) return exact;

    const typeOnly = await tx.quotationTermTemplate.findFirst({
      where: { status: ReferenceStatus.ACTIVE, quotationType, tradeCode: null },
      orderBy: { createdAt: "asc" },
    });
    if (typeOnly) return typeOnly;

    return tx.quotationTermTemplate.findFirst({
      where: { status: ReferenceStatus.ACTIVE, isDefault: true },
      orderBy: { createdAt: "asc" },
    });
  }

  private async resolveDefaultTaxTreatment(
    tx: Prisma.TransactionClient,
    override?: TaxTreatment,
  ): Promise<TaxTreatment> {
    if (override) return override;
    const setting = await tx.systemSetting.findUnique({ where: { key: "default_tax_treatment" } });
    return (setting?.value as TaxTreatment | undefined) ?? DEFAULT_TAX_TREATMENT_FALLBACK;
  }

  // Never accepts a caller override — vat_rate_percent is always read live
  // from system_settings and snapshotted onto the revision at creation, per
  // your explicit instruction. Later changes to the setting never touch
  // already-created revisions, since the value is copied, not referenced.
  private async resolveVatRatePercent(tx: Prisma.TransactionClient): Promise<string> {
    const setting = await tx.systemSetting.findUnique({ where: { key: "vat_rate_percent" } });
    return setting?.value ?? DEFAULT_VAT_RATE_FALLBACK;
  }

  private async assertCustomerExists(customerId: string) {
    const exists = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!exists) throw new NotFoundException("Customer not found");
  }

  private async assertSiteValid(customerId: string, siteId: string) {
    const site = await this.prisma.site.findUnique({
      where: { id: siteId },
      select: { id: true, customerId: true },
    });
    if (!site) throw new NotFoundException("Site not found");
    if (site.customerId !== customerId) {
      throw new BadRequestException("Site must belong to the same customer as the quotation");
    }
  }

  private async assertTradeValid(tradeCode: string) {
    const exists = await this.prisma.trade.findUnique({ where: { code: tradeCode }, select: { code: true } });
    if (!exists) throw new NotFoundException("Trade not found");
  }

  private async findRevisionByIdOrThrow(revisionId: string) {
    const revision = await this.prisma.quotationRevision.findUnique({ where: { id: revisionId } });
    if (!revision) throw new NotFoundException("Quotation revision not found");
    return revision;
  }
}
