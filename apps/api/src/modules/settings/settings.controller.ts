import { Body, Controller, Get, Param, Patch, Req } from "@nestjs/common";
import { Request } from "express";
import { SettingsService } from "./settings.service";
import { UpdateSettingDto } from "./dto/update-setting.dto";
import { Permissions } from "../../common/guards/permissions.decorator";

interface AuthedRequest extends Request {
  user: { userId: string };
}

// No @UseGuards(PermissionsGuard) — already global; see audit.controller.ts.
// This one would have hit the exact DI resolution error caught in testing:
// SettingsModule doesn't import IdentityModule either.
@Permissions({ module: "system_settings", action: "manage" })
@Controller("system-settings")
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  async list() {
    return this.settingsService.list();
  }

  @Patch(":key")
  async update(@Param("key") key: string, @Body() dto: UpdateSettingDto, @Req() req: AuthedRequest) {
    return this.settingsService.update(key, dto.value, {
      userId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.get("user-agent") ?? undefined,
    });
  }
}
