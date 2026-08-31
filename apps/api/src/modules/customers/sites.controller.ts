import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { SitesService } from "./sites.service";
import { UpdateSiteDto } from "./dto/update-site.dto";
import { UpdateSiteStatusDto } from "./dto/update-site-status.dto";
import { EquipmentSystemsService } from "../equipment/equipment-systems.service";
import { AssetsService } from "../equipment/assets.service";
import { CreateEquipmentSystemDto } from "../equipment/dto/create-equipment-system.dto";
import { CreateAssetDto } from "../equipment/dto/create-asset.dto";
import { Permissions } from "../../common/guards/permissions.decorator";
// No @UseGuards(PermissionsGuard) — see customers.controller.ts.

interface AuthedRequest extends Request {
  user: { userId: string };
}

function actorFrom(req: AuthedRequest) {
  return { userId: req.user.userId, ipAddress: req.ip, userAgent: req.get("user-agent") ?? undefined };
}

@Controller("sites")
export class SitesController {
  constructor(
    private readonly sitesService: SitesService,
    private readonly equipmentSystemsService: EquipmentSystemsService,
    private readonly assetsService: AssetsService,
  ) {}

  @Permissions({ module: "sites", action: "read" })
  @Get(":id")
  async get(@Param("id") id: string) {
    return this.sitesService.findByIdOrThrow(id);
  }

  @Permissions({ module: "sites", action: "update" })
  @Patch(":id")
  async update(@Param("id") id: string, @Body() dto: UpdateSiteDto, @Req() req: AuthedRequest) {
    return this.sitesService.update(id, dto, actorFrom(req));
  }

  @Permissions({ module: "sites", action: "deactivate" })
  @Patch(":id/status")
  async updateStatus(@Param("id") id: string, @Body() dto: UpdateSiteStatusDto, @Req() req: AuthedRequest) {
    return this.sitesService.updateStatus(id, dto.status, actorFrom(req));
  }

  @Permissions({ module: "equipment_systems", action: "read" })
  @Get(":id/equipment-systems")
  async listEquipmentSystems(@Param("id") id: string) {
    return this.equipmentSystemsService.listForSite(id);
  }

  @Permissions({ module: "equipment_systems", action: "create" })
  @Post(":id/equipment-systems")
  async createEquipmentSystem(
    @Param("id") id: string,
    @Body() dto: CreateEquipmentSystemDto,
    @Req() req: AuthedRequest,
  ) {
    return this.equipmentSystemsService.create(id, dto, actorFrom(req));
  }

  @Permissions({ module: "assets", action: "read" })
  @Get(":id/assets")
  async listAssets(@Param("id") id: string) {
    return this.assetsService.listForSite(id);
  }

  @Permissions({ module: "assets", action: "create" })
  @Post(":id/assets")
  async createAsset(@Param("id") id: string, @Body() dto: CreateAssetDto, @Req() req: AuthedRequest) {
    return this.assetsService.create(id, dto, actorFrom(req));
  }
}
