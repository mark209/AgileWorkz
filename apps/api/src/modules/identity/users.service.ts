import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import * as argon2 from "argon2";
import { ActorType, Prisma, UserStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { RegisterDto } from "./dto/register.dto";

export interface ActorContext {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}

const USER_SAFE_SELECT = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const REQUESTABLE_ROLE_NAMES = ["Manager", "Office Staff", "Technician"];
const REGISTRATION_TRANSACTION_TIMEOUT_MS = 30_000;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findByEmailWithSecrets(email: string) {
    // The only place password_hash is ever selected — every other query in
    // this service uses USER_SAFE_SELECT.
    const normalizedEmail = email.trim().toLowerCase();
    return (await this.prisma.user.findUnique({ where: { email: normalizedEmail } }))
      ?? this.prisma.user.findFirst({ where: { email: { equals: normalizedEmail, mode: "insensitive" } } });
  }

  async findByIdSafe(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: USER_SAFE_SELECT });
    if (!user) throw new NotFoundException("User not found");
    return user;
  }

  async list() {
    return this.prisma.user.findMany({
      select: { ...USER_SAFE_SELECT, userRoles: { select: { role: { select: { id: true, name: true } } } } },
      orderBy: { fullName: "asc" },
    });
  }

  async requestableDesignations() {
    return this.prisma.role.findMany({
      where: { name: { in: REQUESTABLE_ROLE_NAMES } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }

  async requestRegistration(dto: RegisterDto, meta: { ipAddress?: string; userAgent?: string }) {
    const fullName = dto.fullName.trim();
    const email = dto.email.trim().toLowerCase();
    if (!fullName) throw new BadRequestException("Name is required");

    const role = await this.prisma.role.findUnique({ where: { id: dto.requestedRoleId }, select: { id: true, name: true } });
    if (!role || !REQUESTABLE_ROLE_NAMES.includes(role.name)) {
      throw new BadRequestException("Select an available designation");
    }

    // The public response is identical for new, existing and already-pending emails.
    const [existingUser, existingRequest] = await Promise.all([
      this.prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } }),
      this.prisma.registrationRequest.findUnique({ where: { email }, select: { id: true } }),
    ]);
    if (existingUser || existingRequest) return;

    const passwordHash = await argon2.hash(dto.password);
    try {
      await this.prisma.$transaction(async (tx) => {
        const request = await tx.registrationRequest.create({
          data: { fullName, email, phone: dto.phone?.trim() || null, passwordHash, requestedRoleId: role.id },
          select: { id: true },
        });
        await this.audit.write({
          actorType: ActorType.SYSTEM,
          action: "registration_requested",
          entityType: "registration_request",
          entityId: request.id,
          afterData: { requestedRole: role.name },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        }, tx);
      }, { timeout: REGISTRATION_TRANSACTION_TIMEOUT_MS });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
      throw error;
    }
  }

  private async assertAdminOwner(actor: ActorContext, client: Prisma.TransactionClient | PrismaService = this.prisma) {
    const membership = await client.userRole.findFirst({
      where: { userId: actor.userId, role: { name: "Admin/Owner" } },
      select: { userId: true },
    });
    if (!membership) throw new ForbiddenException("Only Admin/Owner can review registrations");
  }

  async listRegistrationRequests(actor: ActorContext) {
    await this.assertAdminOwner(actor);
    return this.prisma.registrationRequest.findMany({
      select: {
        id: true, fullName: true, email: true, phone: true, createdAt: true,
        requestedRole: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async approveRegistration(requestId: string, roleId: string, actor: ActorContext) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertAdminOwner(actor, tx);
      const request = await tx.registrationRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new NotFoundException("Registration request not found");
      const role = await tx.role.findUnique({ where: { id: roleId }, select: { id: true, name: true } });
      if (!role) throw new BadRequestException("Select an existing role");
      const existing = await tx.user.findFirst({
        where: { email: { equals: request.email, mode: "insensitive" } }, select: { id: true },
      });
      if (existing) throw new ConflictException("An account with this email already exists");

      const user = await tx.user.create({
        data: {
          fullName: request.fullName, email: request.email, phone: request.phone,
          passwordHash: request.passwordHash, status: UserStatus.ACTIVE,
        },
        select: USER_SAFE_SELECT,
      });
      await tx.userRole.create({ data: { userId: user.id, roleId: role.id, assignedBy: actor.userId } });
      await this.audit.write({
        actorType: ActorType.USER, actorUserId: actor.userId, action: "registration_approved",
        entityType: "user", entityId: user.id,
        afterData: { requestedRoleId: request.requestedRoleId, assignedRole: role.name },
        ipAddress: actor.ipAddress, userAgent: actor.userAgent,
      }, tx);
      await tx.registrationRequest.delete({ where: { id: requestId } });
      return user;
    }, { timeout: REGISTRATION_TRANSACTION_TIMEOUT_MS });
  }

  async declineRegistration(requestId: string, actor: ActorContext) {
    await this.prisma.$transaction(async (tx) => {
      await this.assertAdminOwner(actor, tx);
      const request = await tx.registrationRequest.findUnique({ where: { id: requestId }, select: { id: true } });
      if (!request) throw new NotFoundException("Registration request not found");
      await this.audit.write({
        actorType: ActorType.USER, actorUserId: actor.userId, action: "registration_declined",
        entityType: "registration_request", entityId: requestId,
        ipAddress: actor.ipAddress, userAgent: actor.userAgent,
      }, tx);
      await tx.registrationRequest.delete({ where: { id: requestId } });
    }, { timeout: REGISTRATION_TRANSACTION_TIMEOUT_MS });
  }

  async listManagers() {
    return this.prisma.user.findMany({
      where: { status: UserStatus.ACTIVE, userRoles: { some: { role: { name: "Manager" } } } },
      select: { id: true, fullName: true },
      orderBy: { fullName: "asc" },
    });
  }

  /**
   * Phase 4 Operations Frontend (approved Decision 1) — the first of the two
   * new minimal endpoints: lets an Office Staff/Manager/Admin-Owner caller
   * holding work_orders.assign populate a technician picker, without
   * granting them users.manage (the only permission GET /users itself
   * requires). Deliberately narrower than USER_SAFE_SELECT — only the
   * minimum needed for assignment (id, name, status), never email/phone/
   * lastLoginAt.
   *
   * Deliberately filters by the work_orders.start_own PERMISSION, not by a
   * hardcoded role name ("Technician") — this system is permission-driven
   * throughout (roles are just data, per the Rev 7 blueprint), and
   * start_own is the one permission that actually, semantically defines
   * "can be assigned and self-start a Work Order" regardless of what any
   * role granting it happens to be named or renamed to.
   */
  async listTechnicians() {
    return this.prisma.user.findMany({
      where: {
        userRoles: {
          some: { role: { rolePermissions: { some: { permission: { module: "work_orders", action: "start_own" } } } } },
        },
      },
      select: { id: true, fullName: true, status: true },
      orderBy: { fullName: "asc" },
    });
  }

  async create(dto: CreateUserDto, actor: ActorContext) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException("A user with this email already exists");
    }

    const passwordHash = await argon2.hash(dto.password);
    const user = await this.prisma.user.create({
      data: {
        fullName: dto.fullName,
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        status: UserStatus.ACTIVE,
      },
      select: USER_SAFE_SELECT,
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "user_created",
      entityType: "user",
      entityId: user.id,
      afterData: { email: user.email, fullName: user.fullName, status: user.status },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return user;
  }

  async updateStatus(userId: string, status: UserStatus, actor: ActorContext) {
    const before = await this.prisma.user.findUnique({ where: { id: userId }, select: USER_SAFE_SELECT });
    if (!before) throw new NotFoundException("User not found");

    const after = await this.prisma.user.update({
      where: { id: userId },
      data: { status },
      select: USER_SAFE_SELECT,
    });

    // Deactivation/reactivation, never deletion — the row and every history
    // that references it (audit_logs.actor_user_id, etc.) stays intact.
    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "user_status_changed",
      entityType: "user",
      entityId: userId,
      beforeData: { status: before.status },
      afterData: { status: after.status },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return after;
  }

  async recordLogin(userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  }

  async assignRole(userId: string, roleId: string, actor: ActorContext) {
    const [user, role] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.role.findUnique({ where: { id: roleId } }),
    ]);
    if (!user) throw new NotFoundException("User not found");
    if (!role) throw new NotFoundException("Role not found");

    await this.prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId } },
      update: {},
      create: { userId, roleId, assignedBy: actor.userId },
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "role_granted",
      entityType: "user_role",
      entityId: `${userId}:${roleId}`,
      afterData: { userId, roleName: role.name },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }

  async revokeRole(userId: string, roleId: string, actor: ActorContext) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException("Role not found");

    await this.prisma.userRole.delete({ where: { userId_roleId: { userId, roleId } } }).catch(() => {
      throw new NotFoundException("User does not have this role");
    });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "role_revoked",
      entityType: "user_role",
      entityId: `${userId}:${roleId}`,
      beforeData: { userId, roleName: role.name },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }
}
