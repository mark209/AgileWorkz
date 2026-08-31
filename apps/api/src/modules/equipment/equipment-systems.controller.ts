import { Body, Controller, Get, Param, Patch, Req } from "@nestjs/common";
import { Request } from "express";
import { EquipmentSystemsService } from "./equipment-systems.service";
import { UpdateEquipmentSystemDto } from "./dto/update-equipment-system.dto";
import { UpdateEquipmentSystemStatusDto } from "./dto/update-equipment-system-status.dto";
import { Permissions } from "../../common/guards/permissions.decorator";
// No @UseGuards(PermissionsGuard) — see customers.controller.ts.

interface AuthedRequest extends Request {
  user: { userId: string };
}

function actorFrom(req: AuthedRequest) {
  return { userId: req.user.userId, ipAddress: req.ip, userAgent: req.get("user-agent") ?? undefined };
}

@Controller("equipment-systems")
export class EquipmentSystemsController {
  constructor(private readonly equipmentSystemsService: EquipmentSystemsService) {}

  @Permissions({ module: "equipment_systems", action: "read" })
  @Get(":id")
  async get(@Param("id") id: string) {
    return this.equipmentSystemsService.findByIdOrThrow(id);
  }

  @Permissions({ module: "equipment_systems", action: "update" })
  @Patch(":id")
  async update(@Param("id") id: string, @Body() dto: UpdateEquipmentSystemDto, @Req() req: AuthedRequest) {
    return this.equipmentSystemsService.update(id, dto, actorFrom(req));
  }

  @Permissions({ module: "equipment_systems", action: "deactivate" })
  @Patch(":id/status")
  async updateStatus(
    @Param("id") id: string,
    @Body() dto: UpdateEquipmentSystemStatusDto,
    @Req() req: AuthedRequest,
  ) {
    return this.equipmentSystemsService.updateStatus(id, dto.status, actorFrom(req));
  }
}
