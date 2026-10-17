import { Body, Controller, Get, Param, Patch, Req } from "@nestjs/common";
import { Request } from "express";
import { AssetsService } from "./assets.service";
import { UpdateAssetDto } from "./dto/update-asset.dto";
import { UpdateAssetStatusDto } from "./dto/update-asset-status.dto";
import { LinkAssetDto } from "./dto/link-asset.dto";
import { Permissions } from "../../common/guards/permissions.decorator";
// No @UseGuards(PermissionsGuard) — see customers.controller.ts.

interface AuthedRequest extends Request {
  user: { userId: string };
}

function actorFrom(req: AuthedRequest) {
  return { userId: req.user.userId, ipAddress: req.ip, userAgent: req.get("user-agent") ?? undefined };
}

@Controller("assets")
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Permissions({ module: "assets", action: "read" })
  @Get(":id")
  async get(@Param("id") id: string) {
    return this.assetsService.findByIdOrThrow(id);
  }

  @Get(":id/service-reports")
  async serviceHistory(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.assetsService.listServiceHistory(id, actorFrom(req));
  }

  @Permissions({ module: "assets", action: "update" })
  @Patch(":id")
  async update(@Param("id") id: string, @Body() dto: UpdateAssetDto, @Req() req: AuthedRequest) {
    return this.assetsService.update(id, dto, actorFrom(req));
  }

  @Permissions({ module: "assets", action: "deactivate" })
  @Patch(":id/status")
  async updateStatus(@Param("id") id: string, @Body() dto: UpdateAssetStatusDto, @Req() req: AuthedRequest) {
    return this.assetsService.updateStatus(id, dto.status, actorFrom(req));
  }

  @Permissions({ module: "assets", action: "update" })
  @Patch(":id/link")
  async link(@Param("id") id: string, @Body() dto: LinkAssetDto, @Req() req: AuthedRequest) {
    return this.assetsService.link(id, dto, actorFrom(req));
  }
}
