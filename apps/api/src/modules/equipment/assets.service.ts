import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ActorType, AssetStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ActorContext } from "../identity/users.service";
import { ServiceAccessService } from "../identity/service-access.service";
import { changedKeysOf, pickDefined } from "../../common/diff-fields.util";
import { CreateAssetDto } from "./dto/create-asset.dto";
import { UpdateAssetDto } from "./dto/update-asset.dto";
import { LinkAssetDto } from "./dto/link-asset.dto";

const CAPACITY_PAIR_MESSAGE = "capacityValue and capacityUnitCode must be provided together, or not at all";

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ServiceAccessService,
  ) {}

  async findByIdOrThrow(id: string) {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException("Asset not found");
    return asset;
  }

  async listServiceHistory(id: string, actor: ActorContext) {
    await this.findByIdOrThrow(id);
    const scope = await this.access.reportFilter(actor.userId);
    return this.prisma.serviceReport.findMany({
      where: { status: { in: ["VERIFIED", "CONFIRMED", "LOCKED"] }, equipmentUnits: { some: { assetId: id } }, ...scope },
      select: { id: true, serviceReportNumber: true, status: true, serviceDate: true, uploadedAt: true },
      orderBy: { uploadedAt: "desc" },
    });
  }

  async listForSite(siteId: string) {
    await this.assertSiteExists(siteId);
    return this.prisma.asset.findMany({ where: { siteId }, orderBy: { assetTag: "asc" } });
  }

  async create(siteId: string, dto: CreateAssetDto, actor: ActorContext) {
    await this.assertSiteExists(siteId);
    await this.assertEquipmentTypeExists(dto.equipmentTypeCode);
    this.assertCapacityPairValid(dto.capacityValue, dto.capacityUnitCode);
    if (dto.capacityUnitCode) await this.assertCapacityUnitExists(dto.capacityUnitCode);
    if (dto.equipmentSystemId) await this.assertEquipmentSystemValid(siteId, dto.equipmentSystemId);
    if (dto.parentAssetId) await this.assertParentAssetValid(siteId, dto.parentAssetId);
    await this.assertAssetTagAvailable(siteId, dto.assetTag);

    const asset = await this.prisma.asset.create({ data: { ...dto, siteId } });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "asset_created",
      entityType: "asset",
      entityId: asset.id,
      afterData: {
        siteId,
        assetTag: asset.assetTag,
        equipmentTypeCode: asset.equipmentTypeCode,
        status: asset.status,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return asset;
  }

  async update(id: string, dto: UpdateAssetDto, actor: ActorContext) {
    const before = await this.findByIdOrThrow(id);

    if (dto.equipmentTypeCode) await this.assertEquipmentTypeExists(dto.equipmentTypeCode);

    const nextCapacityValue = dto.capacityValue !== undefined ? dto.capacityValue : before.capacityValue;
    const nextCapacityUnitCode = dto.capacityUnitCode !== undefined ? dto.capacityUnitCode : before.capacityUnitCode;
    this.assertCapacityPairValid(nextCapacityValue, nextCapacityUnitCode);
    if (dto.capacityUnitCode) await this.assertCapacityUnitExists(dto.capacityUnitCode);

    if (dto.assetTag && dto.assetTag !== before.assetTag) {
      await this.assertAssetTagAvailable(before.siteId, dto.assetTag);
    }

    const changedKeys = changedKeysOf(dto);
    const after = await this.prisma.asset.update({ where: { id }, data: dto });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "asset_updated",
      entityType: "asset",
      entityId: id,
      beforeData: pickDefined(before, changedKeys),
      afterData: pickDefined(after, changedKeys),
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  async updateStatus(id: string, status: AssetStatus, actor: ActorContext) {
    const before = await this.findByIdOrThrow(id);
    const after = await this.prisma.asset.update({ where: { id }, data: { status } });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "asset_status_changed",
      entityType: "asset",
      entityId: id,
      beforeData: { status: before.status },
      afterData: { status: after.status },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  // Direct pairing (parentAssetId) and logical grouping (equipmentSystemId)
  // are re-linked here, and only here, after creation — a distinct action
  // (asset_regrouped) from asset_updated, since re-pairing equipment (e.g.
  // an indoor unit moved to a replacement outdoor unit) is a structural
  // event worth finding directly in the audit trail. See the approved Asset
  // Model document.
  async link(id: string, dto: LinkAssetDto, actor: ActorContext) {
    const before = await this.findByIdOrThrow(id);

    if (dto.parentAssetId) {
      if (dto.parentAssetId === id) {
        throw new BadRequestException("An asset cannot be its own parent");
      }
      await this.assertParentAssetValid(before.siteId, dto.parentAssetId);
    }
    if (dto.equipmentSystemId) {
      await this.assertEquipmentSystemValid(before.siteId, dto.equipmentSystemId);
    }

    const changedKeys = changedKeysOf(dto);
    const after = await this.prisma.asset.update({ where: { id }, data: dto });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "asset_regrouped",
      entityType: "asset",
      entityId: id,
      beforeData: pickDefined(before, changedKeys),
      afterData: pickDefined(after, changedKeys),
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  private async assertSiteExists(siteId: string) {
    const exists = await this.prisma.site.findUnique({ where: { id: siteId }, select: { id: true } });
    if (!exists) throw new NotFoundException("Site not found");
  }

  private async assertEquipmentTypeExists(code: string) {
    const exists = await this.prisma.equipmentType.findUnique({ where: { code }, select: { code: true } });
    if (!exists) throw new NotFoundException("Equipment type not found");
  }

  private async assertCapacityUnitExists(code: string) {
    const exists = await this.prisma.capacityUnit.findUnique({ where: { code }, select: { code: true } });
    if (!exists) throw new NotFoundException("Capacity unit not found");
  }

  private assertCapacityPairValid(capacityValue: unknown, capacityUnitCode: unknown) {
    const hasValue = capacityValue !== undefined && capacityValue !== null;
    const hasUnit = capacityUnitCode !== undefined && capacityUnitCode !== null;
    if (hasValue !== hasUnit) {
      throw new BadRequestException(CAPACITY_PAIR_MESSAGE);
    }
  }

  private async assertEquipmentSystemValid(siteId: string, equipmentSystemId: string) {
    const system = await this.prisma.equipmentSystem.findUnique({
      where: { id: equipmentSystemId },
      select: { id: true, siteId: true },
    });
    if (!system) throw new NotFoundException("Equipment system not found");
    if (system.siteId !== siteId) {
      throw new BadRequestException("Equipment system must belong to the same site as the asset");
    }
  }

  private async assertParentAssetValid(siteId: string, parentAssetId: string) {
    const parent = await this.prisma.asset.findUnique({
      where: { id: parentAssetId },
      select: { id: true, siteId: true },
    });
    if (!parent) throw new NotFoundException("Parent asset not found");
    if (parent.siteId !== siteId) {
      throw new BadRequestException("Parent asset must belong to the same site as this asset");
    }
  }

  private async assertAssetTagAvailable(siteId: string, assetTag: string) {
    const existing = await this.prisma.asset.findUnique({
      where: { siteId_assetTag: { siteId, assetTag } },
    });
    if (existing) {
      throw new ConflictException("An asset with this tag already exists at this site");
    }
  }
}
