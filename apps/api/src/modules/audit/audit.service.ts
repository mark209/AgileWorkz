import { Injectable } from "@nestjs/common";
import { ActorType, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface WriteAuditEntryInput {
  actorType: ActorType;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuditQuery {
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
  action?: string;
  from?: Date;
  to?: Date;
  take?: number;
  skip?: number;
}

/**
 * Append-only by construction: this class exposes `write` and `query` and
 * nothing else. There is no `update`, no `delete`, no method that could ever
 * mutate an existing row — the code-level half of the guarantee whose
 * database-level half is the `app_runtime` role's missing UPDATE/DELETE
 * grant on audit_logs (see infra/sql/provision-roles.sql).
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Phase 5 Step 6 (Confirm) addition — an optional transactional client.
   * Confirm's approved design requires the audit write to be part of the
   * SAME atomic transaction as the canonical writes and status change (a
   * failure anywhere must roll back the audit entry too, not just leave it
   * orphaned pointing at a confirm that never happened). `this.prisma` is a
   * distinct DB connection from a `tx` handed out by
   * `prisma.$transaction(async (tx) => ...)`, so writing via `this.prisma`
   * from inside someone else's transaction callback would silently NOT be
   * part of it. Every existing call site is unaffected — `tx` defaults to
   * undefined, in which case behavior is byte-for-byte identical to before.
   */
  async write(input: WriteAuditEntryInput, tx?: Prisma.TransactionClient): Promise<void> {
    if (input.actorType === ActorType.USER && !input.actorUserId) {
      throw new Error(
        "AuditService.write: actorType USER requires actorUserId — actor_user_id alone must never be the signal for actor classification.",
      );
    }

    const client = tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        actorType: input.actorType,
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        beforeData: (input.beforeData ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        afterData: (input.afterData ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        reason: input.reason ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  }

  async query(filter: AuditQuery) {
    return this.prisma.auditLog.findMany({
      where: {
        entityType: filter.entityType,
        entityId: filter.entityId,
        actorUserId: filter.actorUserId,
        action: filter.action,
        createdAt:
          filter.from || filter.to
            ? { gte: filter.from, lte: filter.to }
            : undefined,
      },
      orderBy: { createdAt: "desc" },
      take: filter.take ?? 50,
      skip: filter.skip ?? 0,
    });
  }
}
