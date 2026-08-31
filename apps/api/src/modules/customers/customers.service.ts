import { Injectable, NotFoundException } from "@nestjs/common";
import { ActorType, CustomerStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ActorContext } from "../identity/users.service";
import { changedKeysOf, pickDefined } from "../../common/diff-fields.util";
import { CreateCustomerDto } from "./dto/create-customer.dto";
import { UpdateCustomerDto } from "./dto/update-customer.dto";

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findByIdOrThrow(id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException("Customer not found");
    return customer;
  }

  async list() {
    return this.prisma.customer.findMany({ orderBy: { name: "asc" } });
  }

  async create(dto: CreateCustomerDto, actor: ActorContext) {
    await this.assertAccountManagerExists(dto.accountManagerId);

    const customer = await this.prisma.customer.create({ data: dto });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "customer_created",
      entityType: "customer",
      entityId: customer.id,
      afterData: { name: customer.name, customerType: customer.customerType, status: customer.status },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return customer;
  }

  async update(id: string, dto: UpdateCustomerDto, actor: ActorContext) {
    const before = await this.findByIdOrThrow(id);
    await this.assertAccountManagerExists(dto.accountManagerId);

    const changedKeys = changedKeysOf(dto);
    const after = await this.prisma.customer.update({ where: { id }, data: dto });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "customer_updated",
      entityType: "customer",
      entityId: id,
      beforeData: pickDefined(before, changedKeys),
      afterData: pickDefined(after, changedKeys),
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  async updateStatus(id: string, status: CustomerStatus, actor: ActorContext) {
    const before = await this.findByIdOrThrow(id);
    const after = await this.prisma.customer.update({ where: { id }, data: { status } });

    // Approved Decision 1: statuses are fully independent. Deactivating a
    // customer never touches its sites/assets — no cascade, here or anywhere
    // else in this service. Historical visibility is preserved; gating new
    // transactions for an inactive customer belongs to the transactional
    // modules (Quotations/Work Orders) that exist starting Phase 3, not here.
    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "customer_status_changed",
      entityType: "customer",
      entityId: id,
      beforeData: { status: before.status },
      afterData: { status: after.status },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  private async assertAccountManagerExists(accountManagerId: string | undefined) {
    if (!accountManagerId) return;
    const exists = await this.prisma.user.findUnique({ where: { id: accountManagerId }, select: { id: true } });
    if (!exists) throw new NotFoundException("Account manager (user) not found");
  }
}
