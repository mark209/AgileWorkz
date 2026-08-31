import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { ActorType, UserStatus } from "@prisma/client";
import { AuthenticatedUser, LoginResponseDto } from "@agileworks/shared-types";
import { UsersService } from "./users.service";
import { PermissionsService } from "./permissions.service";
import { AuditService } from "../audit/audit.service";

export interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string, meta: RequestMeta): Promise<LoginResponseDto> {
    const user = await this.users.findByEmailWithSecrets(email);

    if (!user) {
      // No matching account — there is no real user to attribute this to,
      // so this is recorded as a SYSTEM event rather than guessing a USER
      // actor_user_id that doesn't exist. actor_user_id stays null, but the
      // classification (why it's null) is explicit via actorType.
      await this.audit.write({
        actorType: ActorType.SYSTEM,
        action: "login_failed",
        entityType: "auth",
        afterData: { email, reason: "no_matching_account" },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      throw new UnauthorizedException("Invalid credentials");
    }

    if (user.status !== UserStatus.ACTIVE) {
      await this.audit.write({
        actorType: ActorType.USER,
        actorUserId: user.id,
        action: "login_failed",
        entityType: "auth",
        afterData: { reason: "account_not_active", status: user.status },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      throw new UnauthorizedException("Invalid credentials");
    }

    const passwordValid = await argon2.verify(user.passwordHash, password);
    if (!passwordValid) {
      await this.audit.write({
        actorType: ActorType.USER,
        actorUserId: user.id,
        action: "login_failed",
        entityType: "auth",
        afterData: { reason: "bad_password" },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      throw new UnauthorizedException("Invalid credentials");
    }

    await this.users.recordLogin(user.id);
    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: user.id,
      action: "login",
      entityType: "auth",
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    const authenticatedUser = await this.buildAuthenticatedUser(user.id, user.fullName, user.email, user.status);
    return {
      ...(await this.issueTokens(user.id)),
      user: authenticatedUser,
    };
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    let payload: { sub: string };
    try {
      payload = this.jwt.verify(refreshToken, { secret: process.env.JWT_REFRESH_SECRET });
    } catch {
      throw new UnauthorizedException("Invalid refresh token");
    }

    const user = await this.users.findByIdSafe(payload.sub).catch(() => null);
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException("Invalid refresh token");
    }

    return this.issueTokens(user.id);
  }

  async logout(userId: string, meta: RequestMeta): Promise<void> {
    // Phase 1 issues stateless JWTs with no server-side refresh-token store,
    // so "logout" has nothing to revoke server-side yet — it's recorded for
    // the audit trail, and the client discards its tokens. A revocation list
    // (e.g. a refresh_tokens table) is a reasonable Phase 2+ addition if
    // immediate server-side revocation is required before token expiry.
    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: userId,
      action: "logout",
      entityType: "auth",
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }

  async buildAuthenticatedUser(
    userId: string,
    fullName: string,
    email: string,
    status: UserStatus,
  ): Promise<AuthenticatedUser> {
    const [roles, permissions] = await Promise.all([
      this.permissions.getRoleNames(userId),
      this.permissions.getEffectivePermissions(userId),
    ]);
    return { id: userId, fullName, email, status, roles, permissions };
  }

  private async issueTokens(userId: string): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = this.jwt.sign(
      { sub: userId },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: process.env.JWT_ACCESS_TTL ?? "15m" },
    );
    const refreshToken = this.jwt.sign(
      { sub: userId },
      { secret: process.env.JWT_REFRESH_SECRET, expiresIn: process.env.JWT_REFRESH_TTL ?? "7d" },
    );
    return { accessToken, refreshToken };
  }
}
