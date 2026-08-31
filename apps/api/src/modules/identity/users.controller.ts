import { Body, Controller, Get, Param, Patch, Post, Delete, Req } from "@nestjs/common";
import { Request } from "express";
import { UsersService } from "./users.service";
import { AuthService } from "./auth.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserStatusDto } from "./dto/update-user-status.dto";
import { Permissions } from "../../common/guards/permissions.decorator";
// No @UseGuards(PermissionsGuard) anywhere below — it's already global
// (AppModule's APP_GUARD); see audit.controller.ts for why repeating it
// per-route is redundant at best and a DI resolution error at worst.

interface AuthedRequest extends Request {
  user: { userId: string };
}

function actorFrom(req: AuthedRequest) {
  return { userId: req.user.userId, ipAddress: req.ip, userAgent: req.get("user-agent") ?? undefined };
}

@Controller("users")
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
  ) {}

  @Get("me")
  async me(@Req() req: AuthedRequest) {
    const user = await this.usersService.findByIdSafe(req.user.userId);
    return this.authService.buildAuthenticatedUser(user.id, user.fullName, user.email, user.status);
  }

  @Permissions({ module: "users", action: "manage" })
  @Get()
  async list() {
    return this.usersService.list();
  }

  // Phase 4 Operations Frontend (approved Decision 1) — a deliberately
  // separate, narrower route from the one above: gated on work_orders.assign
  // (already held by Office Staff/Manager/Admin-Owner) rather than the
  // Admin-only users.manage, and returning only id/fullName/status. A
  // distinct literal path ("technicians"), not a query param on GET /users,
  // so the two routes' very different authorization/response shapes are
  // never conflated.
  @Permissions({ module: "work_orders", action: "assign" })
  @Get("technicians")
  async listTechnicians() {
    return this.usersService.listTechnicians();
  }

  @Permissions({ module: "users", action: "manage" })
  @Post()
  async create(@Body() dto: CreateUserDto, @Req() req: AuthedRequest) {
    return this.usersService.create(dto, actorFrom(req));
  }

  @Permissions({ module: "users", action: "manage" })
  @Patch(":id/status")
  async updateStatus(
    @Param("id") id: string,
    @Body() dto: UpdateUserStatusDto,
    @Req() req: AuthedRequest,
  ) {
    return this.usersService.updateStatus(id, dto.status, actorFrom(req));
  }

  @Permissions({ module: "users", action: "manage" })
  @Post(":id/roles/:roleId")
  async assignRole(@Param("id") id: string, @Param("roleId") roleId: string, @Req() req: AuthedRequest) {
    await this.usersService.assignRole(id, roleId, actorFrom(req));
    return { assigned: true };
  }

  @Permissions({ module: "users", action: "manage" })
  @Delete(":id/roles/:roleId")
  async revokeRole(@Param("id") id: string, @Param("roleId") roleId: string, @Req() req: AuthedRequest) {
    await this.usersService.revokeRole(id, roleId, actorFrom(req));
    return { revoked: true };
  }
}
