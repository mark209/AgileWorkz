import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ActorType, ReferenceStatus, TaxTreatment } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";

export interface CatalogItemInput {
  description: string;
  specification?: string;
  brand?: string;
  model?: string;
  unit: string;
  unitPriceBeforeVat: number;
  taxTreatment: TaxTreatment;
}

@Injectable()
export class QuotationLineCatalogService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  list(activeOnly: boolean) {
    return this.prisma.quotationLineCatalogItem.findMany({
      where: activeOnly ? { status: ReferenceStatus.ACTIVE } : undefined,
      orderBy: { description: "asc" },
    });
  }

  async create(input: CatalogItemInput, actorUserId: string) {
    if (!input.description?.trim() || !input.unit?.trim() || !Number.isFinite(input.unitPriceBeforeVat) || input.unitPriceBeforeVat < 0) {
      throw new BadRequestException("Description, unit, and a valid nonnegative selling price are required");
    }
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.quotationLineCatalogItem.create({ data: {
        description: input.description.trim(), specification: input.specification?.trim() || null,
        brand: input.brand?.trim() || null, model: input.model?.trim() || null,
        unit: input.unit.trim(), unitPriceBeforeVat: input.unitPriceBeforeVat,
        taxTreatment: input.taxTreatment,
      } });
      await this.audit.write({ actorType: ActorType.USER, actorUserId, action: "quotation_line_catalog_created", entityType: "quotation_line_catalog_item", entityId: item.id, afterData: { description: item.description } }, tx);
      return item;
    });
  }

  async update(id: string, input: CatalogItemInput, actorUserId: string) {
    if (!input.description?.trim() || !input.unit?.trim() || !Number.isFinite(input.unitPriceBeforeVat) || input.unitPriceBeforeVat < 0) {
      throw new BadRequestException("Description, unit, and a valid nonnegative selling price are required");
    }
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.quotationLineCatalogItem.findUnique({ where: { id } });
      if (!before) throw new NotFoundException("Saved line item not found");
      const item = await tx.quotationLineCatalogItem.update({ where: { id }, data: {
        description: input.description.trim(), specification: input.specification?.trim() || null,
        brand: input.brand?.trim() || null, model: input.model?.trim() || null,
        unit: input.unit.trim(), unitPriceBeforeVat: input.unitPriceBeforeVat,
        taxTreatment: input.taxTreatment,
      } });
      await this.audit.write({ actorType: ActorType.USER, actorUserId, action: "quotation_line_catalog_updated", entityType: "quotation_line_catalog_item", entityId: id,
        beforeData: { description: before.description, unit: before.unit, unitPriceBeforeVat: before.unitPriceBeforeVat.toString(), taxTreatment: before.taxTreatment },
        afterData: { description: item.description, unit: item.unit, unitPriceBeforeVat: item.unitPriceBeforeVat.toString(), taxTreatment: item.taxTreatment },
      }, tx);
      return item;
    });
  }

  async setStatus(id: string, status: ReferenceStatus, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.quotationLineCatalogItem.findUnique({ where: { id } });
      if (!before) throw new NotFoundException("Saved line item not found");
      const item = await tx.quotationLineCatalogItem.update({ where: { id }, data: { status } });
      await this.audit.write({ actorType: ActorType.USER, actorUserId, action: "quotation_line_catalog_status_changed", entityType: "quotation_line_catalog_item", entityId: id, beforeData: { status: before.status }, afterData: { status } }, tx);
      return item;
    });
  }
}
