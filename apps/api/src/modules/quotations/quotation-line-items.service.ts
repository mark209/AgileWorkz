import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ActorType, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ActorContext } from "../identity/users.service";
import { changedKeysOf, pickDefined } from "../../common/diff-fields.util";
import { assertRevisionEditable } from "./revision-lock.util";
import { QuotationPricingService } from "./pricing/quotation-pricing.service";
import { round2 } from "./pricing/revision-pricing.util";
import { CreateLineItemDto } from "./dto/create-line-item.dto";
import { UpdateLineItemDto } from "./dto/update-line-item.dto";

const MATERIAL_LABOR_TOLERANCE = new Prisma.Decimal("0.02");

@Injectable()
export class QuotationLineItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pricing: QuotationPricingService,
  ) {}

  async list(revisionId: string) {
    await this.findRevisionOrThrow(revisionId);
    return this.prisma.quotationLineItem.findMany({
      where: { quotationRevisionId: revisionId },
      orderBy: { sortOrder: "asc" },
    });
  }

  async create(revisionId: string, dto: CreateLineItemDto, actor: ActorContext) {
    const revision = await this.findRevisionOrThrow(revisionId);
    assertRevisionEditable(revision);
    if (dto.sectionId) await this.assertSectionValid(revisionId, dto.sectionId);
    if (dto.assetId) await this.assertAssetValid(revisionId, dto.assetId);

    const { unitCostExpense, markupPercent, unitPriceBeforeVat } = this.resolvePricingMode({
      unitCostExpense: dto.unitCostExpense,
      markupPercent: dto.markupPercent,
      unitPriceBeforeVat: dto.unitPriceBeforeVat,
    });
    this.assertMaterialLaborConsistent(dto.materialAmount, dto.laborAmount, unitPriceBeforeVat);

    const line = await this.prisma.$transaction(async (tx) => {
      const created = await tx.quotationLineItem.create({
        data: {
          quotationRevisionId: revisionId,
          sectionId: dto.sectionId,
          assetId: dto.assetId,
          description: dto.description,
          specification: dto.specification,
          brand: dto.brand,
          model: dto.model,
          quantity: dto.quantity,
          unit: dto.unit,
          unitCostExpense,
          markupPercent,
          // Placeholder — QuotationPricingService.recalculate() immediately
          // overwrites every server-computed field below, including this
          // one; a real value is required at insert time only because the
          // column is NOT NULL.
          unitPriceBeforeVat: unitPriceBeforeVat ?? 0,
          taxTreatment: dto.taxTreatment ?? revision.defaultTaxTreatment,
          materialAmount: dto.materialAmount,
          laborAmount: dto.laborAmount,
          unitPrice: 0,
          lineAmount: 0,
          lineFinalAmount: 0,
          lineNetAmount: 0,
          lineVatAmount: 0,
          sortOrder: dto.sortOrder ?? (await this.nextSortOrder(tx, revisionId)),
        },
      });
      await this.pricing.recalculate(tx, revisionId);
      return tx.quotationLineItem.findUniqueOrThrow({ where: { id: created.id } });
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "line_item_created",
      entityType: "quotation_line_item",
      entityId: line.id,
      afterData: {
        quotationRevisionId: revisionId,
        description: line.description,
        quantity: line.quantity.toString(),
        unitPrice: line.unitPrice.toString(),
        lineAmount: line.lineAmount.toString(),
        taxTreatment: line.taxTreatment,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return line;
  }

  async update(revisionId: string, lineItemId: string, dto: UpdateLineItemDto, actor: ActorContext) {
    const revision = await this.findRevisionOrThrow(revisionId);
    assertRevisionEditable(revision);
    const before = await this.findLineItemOrThrow(revisionId, lineItemId);
    if (dto.sectionId) await this.assertSectionValid(revisionId, dto.sectionId);
    if (dto.assetId) await this.assertAssetValid(revisionId, dto.assetId);

    // Merge-then-resolve: the pricing mode is re-evaluated against the
    // EFFECTIVE (existing + patched) values, not the patch in isolation —
    // otherwise patching just one of a costed pair would leave the line in
    // an inconsistent state.
    const effective = {
      unitCostExpense: dto.unitCostExpense !== undefined ? dto.unitCostExpense ?? undefined : toNumber(before.unitCostExpense),
      markupPercent: dto.markupPercent !== undefined ? dto.markupPercent ?? undefined : toNumber(before.markupPercent),
      unitPriceBeforeVat:
        dto.unitPriceBeforeVat !== undefined ? dto.unitPriceBeforeVat : toNumber(before.unitPriceBeforeVat),
    };
    const { unitCostExpense, markupPercent, unitPriceBeforeVat } = this.resolvePricingMode(effective);

    const effectiveMaterial = dto.materialAmount !== undefined ? dto.materialAmount ?? undefined : toNumber(before.materialAmount);
    const effectiveLabor = dto.laborAmount !== undefined ? dto.laborAmount ?? undefined : toNumber(before.laborAmount);
    this.assertMaterialLaborConsistent(effectiveMaterial, effectiveLabor, unitPriceBeforeVat);

    const changedKeys = changedKeysOf(dto);
    const after = await this.prisma.$transaction(async (tx) => {
      await tx.quotationLineItem.update({
        where: { id: lineItemId },
        data: {
          description: dto.description,
          specification: dto.specification,
          brand: dto.brand,
          model: dto.model,
          quantity: dto.quantity,
          unit: dto.unit,
          unitCostExpense,
          markupPercent,
          unitPriceBeforeVat: unitPriceBeforeVat ?? before.unitPriceBeforeVat,
          taxTreatment: dto.taxTreatment,
          materialAmount: dto.materialAmount,
          laborAmount: dto.laborAmount,
          sectionId: dto.sectionId,
          assetId: dto.assetId,
          sortOrder: dto.sortOrder,
        },
      });
      await this.pricing.recalculate(tx, revisionId);
      return tx.quotationLineItem.findUniqueOrThrow({ where: { id: lineItemId } });
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "line_item_updated",
      entityType: "quotation_line_item",
      entityId: lineItemId,
      beforeData: pickDefined(before, changedKeys),
      afterData: pickDefined(after, changedKeys),
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  async remove(revisionId: string, lineItemId: string, actor: ActorContext) {
    const revision = await this.findRevisionOrThrow(revisionId);
    assertRevisionEditable(revision);
    const before = await this.findLineItemOrThrow(revisionId, lineItemId);

    await this.prisma.$transaction(async (tx) => {
      await tx.quotationLineItem.delete({ where: { id: lineItemId } });
      await this.pricing.recalculate(tx, revisionId);
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "line_item_deleted",
      entityType: "quotation_line_item",
      entityId: lineItemId,
      beforeData: { description: before.description, quotationRevisionId: revisionId },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }

  // Resolves which of the two pricing modes applies (§06a): cost + markup
  // (both present) always wins and drives unit_price_before_vat, overwriting
  // any direct value also supplied — an already-frozen rule, not treated as
  // an error. Otherwise a direct unit_price_before_vat is required.
  private resolvePricingMode(input: {
    unitCostExpense?: number;
    markupPercent?: number;
    unitPriceBeforeVat?: number;
  }): { unitCostExpense: Prisma.Decimal | null; markupPercent: Prisma.Decimal | null; unitPriceBeforeVat: Prisma.Decimal | null } {
    const hasCost = input.unitCostExpense !== undefined;
    const hasMarkup = input.markupPercent !== undefined;
    if (hasCost !== hasMarkup) {
      throw new BadRequestException("unitCostExpense and markupPercent must be provided together, or not at all");
    }
    if (hasCost && hasMarkup) {
      return {
        unitCostExpense: round2(input.unitCostExpense!),
        markupPercent: round2(input.markupPercent!),
        unitPriceBeforeVat: null, // computed by QuotationPricingService
      };
    }
    if (input.unitPriceBeforeVat === undefined) {
      throw new BadRequestException(
        "Provide either (unitCostExpense and markupPercent) or unitPriceBeforeVat directly",
      );
    }
    return { unitCostExpense: null, markupPercent: null, unitPriceBeforeVat: round2(input.unitPriceBeforeVat) };
  }

  // §06 design rationale: when both material_amount and labor_amount are
  // present, they must sum to unit_price_before_vat (small rounding
  // tolerance) — app-validated, not a DB constraint, same as the plan says.
  private assertMaterialLaborConsistent(
    materialAmount: number | undefined,
    laborAmount: number | undefined,
    unitPriceBeforeVat: Prisma.Decimal | null,
  ) {
    if (materialAmount === undefined || laborAmount === undefined) return;
    const sum = round2(materialAmount).plus(round2(laborAmount));
    const target = unitPriceBeforeVat ?? new Prisma.Decimal(0);
    if (sum.minus(target).abs().greaterThan(MATERIAL_LABOR_TOLERANCE)) {
      throw new BadRequestException("materialAmount + laborAmount must sum to unitPriceBeforeVat");
    }
  }

  private async nextSortOrder(tx: Prisma.TransactionClient, revisionId: string): Promise<number> {
    const last = await tx.quotationLineItem.findFirst({
      where: { quotationRevisionId: revisionId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    return (last?.sortOrder ?? -10) + 10;
  }

  private async findRevisionOrThrow(revisionId: string) {
    const revision = await this.prisma.quotationRevision.findUnique({ where: { id: revisionId } });
    if (!revision) throw new NotFoundException("Quotation revision not found");
    return revision;
  }

  private async findLineItemOrThrow(revisionId: string, lineItemId: string) {
    const line = await this.prisma.quotationLineItem.findUnique({ where: { id: lineItemId } });
    if (!line || line.quotationRevisionId !== revisionId) {
      throw new NotFoundException("Line item not found");
    }
    return line;
  }

  private async assertSectionValid(revisionId: string, sectionId: string) {
    const section = await this.prisma.quotationSection.findUnique({
      where: { id: sectionId },
      select: { id: true, quotationRevisionId: true },
    });
    if (!section) throw new NotFoundException("Section not found");
    if (section.quotationRevisionId !== revisionId) {
      throw new BadRequestException("Section must belong to the same revision as the line item");
    }
  }

  // Inferred rule, not explicit in the frozen plan: a linked asset must
  // belong to the same site as the quotation — same "same-parent"
  // validation pattern used everywhere else in this codebase.
  private async assertAssetValid(revisionId: string, assetId: string) {
    const revision = await this.prisma.quotationRevision.findUniqueOrThrow({
      where: { id: revisionId },
      select: { quotation: { select: { siteId: true } } },
    });
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId }, select: { id: true, siteId: true } });
    if (!asset) throw new NotFoundException("Asset not found");
    if (asset.siteId !== revision.quotation.siteId) {
      throw new BadRequestException("Asset must belong to the same site as the quotation");
    }
  }
}

function toNumber(value: Prisma.Decimal | null): number | undefined {
  return value === null ? undefined : value.toNumber();
}
