import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ActorType, ContactStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ActorContext } from "../identity/users.service";
import { changedKeysOf, pickDefined } from "../../common/diff-fields.util";
import { CreateContactDto } from "./dto/create-contact.dto";
import { UpdateContactDto } from "./dto/update-contact.dto";

const AT_LEAST_ONE_CONTACT_METHOD = "A contact must have at least a phone number or an email address";

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findByIdOrThrow(id: string) {
    const contact = await this.prisma.contact.findUnique({ where: { id } });
    if (!contact) throw new NotFoundException("Contact not found");
    return contact;
  }

  async listForCustomer(customerId: string) {
    await this.assertCustomerExists(customerId);
    return this.prisma.contact.findMany({ where: { customerId }, orderBy: { fullName: "asc" } });
  }

  async create(customerId: string, dto: CreateContactDto, actor: ActorContext) {
    await this.assertCustomerExists(customerId);
    if (!dto.phone && !dto.email) {
      throw new BadRequestException(AT_LEAST_ONE_CONTACT_METHOD);
    }

    const contact = await this.prisma.contact.create({
      data: { ...dto, customerId, isPrimary: dto.isPrimary ?? false },
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "contact_created",
      entityType: "contact",
      entityId: contact.id,
      afterData: { customerId, fullName: contact.fullName, status: contact.status },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return contact;
  }

  async update(id: string, dto: UpdateContactDto, actor: ActorContext) {
    const before = await this.findByIdOrThrow(id);

    const nextPhone = dto.phone !== undefined ? dto.phone : before.phone;
    const nextEmail = dto.email !== undefined ? dto.email : before.email;
    if (!nextPhone && !nextEmail) {
      throw new BadRequestException(AT_LEAST_ONE_CONTACT_METHOD);
    }

    const changedKeys = changedKeysOf(dto);
    const after = await this.prisma.contact.update({ where: { id }, data: dto });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "contact_updated",
      entityType: "contact",
      entityId: id,
      beforeData: pickDefined(before, changedKeys),
      afterData: pickDefined(after, changedKeys),
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  async updateStatus(id: string, status: ContactStatus, actor: ActorContext) {
    const before = await this.findByIdOrThrow(id);
    const after = await this.prisma.contact.update({ where: { id }, data: { status } });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "contact_status_changed",
      entityType: "contact",
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
}
