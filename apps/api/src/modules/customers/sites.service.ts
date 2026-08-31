import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ActorType, SiteStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ActorContext } from "../identity/users.service";
import { changedKeysOf, pickDefined } from "../../common/diff-fields.util";
import { CreateSiteDto } from "./dto/create-site.dto";
import { UpdateSiteDto } from "./dto/update-site.dto";

@Injectable()
export class SitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findByIdOrThrow(id: string) {
    const site = await this.prisma.site.findUnique({ where: { id } });
    if (!site) throw new NotFoundException("Site not found");
    return site;
  }

  async listForCustomer(customerId: string) {
    await this.assertCustomerExists(customerId);
    return this.prisma.site.findMany({ where: { customerId }, orderBy: { label: "asc" } });
  }

  async create(customerId: string, dto: CreateSiteDto, actor: ActorContext) {
    await this.assertCustomerExists(customerId);
    await this.assertPrimaryContactValid(customerId, dto.primaryContactId);

    const site = await this.prisma.site.create({ data: { ...dto, customerId } });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "site_created",
      entityType: "site",
      entityId: site.id,
      afterData: { customerId, label: site.label, status: site.status },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return site;
  }

  async update(id: string, dto: UpdateSiteDto, actor: ActorContext) {
    const before = await this.findByIdOrThrow(id);
    await this.assertPrimaryContactValid(before.customerId, dto.primaryContactId);

    const changedKeys = changedKeysOf(dto);
    const after = await this.prisma.site.update({ where: { id }, data: dto });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "site_updated",
      entityType: "site",
      entityId: id,
      beforeData: pickDefined(before, changedKeys),
      afterData: pickDefined(after, changedKeys),
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  async updateStatus(id: string, status: SiteStatus, actor: ActorContext) {
    const before = await this.findByIdOrThrow(id);
    const after = await this.prisma.site.update({ where: { id }, data: { status } });

    // Approved Decision 1: statuses are fully independent — deactivating a
    // site never cascades to its customer or its assets.
    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "site_status_changed",
      entityType: "site",
      entityId: id,
      beforeData: { status: before.status },
      afterData: { status: after.status },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  private async assertCustomerExists(customerId: string) {
    const exists = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!exists) throw new NotFoundException("Customer not found");
  }

  private async assertPrimaryContactValid(customerId: string, primaryContactId: string | undefined) {
    if (!primaryContactId) return;
    const contact = await this.prisma.contact.findUnique({
      where: { id: primaryContactId },
      select: { id: true, customerId: true },
    });
    if (!contact) throw new NotFoundException("Primary contact not found");
    if (contact.customerId !== customerId) {
      throw new BadRequestException("Primary contact must belong to the same customer as the site");
    }
  }
}
