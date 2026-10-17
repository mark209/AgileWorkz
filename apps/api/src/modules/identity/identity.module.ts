import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { UsersService } from "./users.service";
import { UsersController } from "./users.controller";
import { RolesService } from "./roles.service";
import { RolesController } from "./roles.controller";
import { PermissionsService } from "./permissions.service";
import { ServiceAccessService } from "./service-access.service";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { JwtStrategy } from "./jwt.strategy";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [PassportModule, JwtModule.register({}), AuditModule],
  controllers: [AuthController, UsersController, RolesController],
  providers: [UsersService, RolesService, PermissionsService, ServiceAccessService, AuthService, JwtStrategy],
  // PermissionsService is consumed by PermissionsGuard from outside this
  // module (via AppModule's APP_GUARD wiring), so it must be exported.
  exports: [PermissionsService, ServiceAccessService, UsersService, AuthService],
})
export class IdentityModule {}
