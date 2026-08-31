import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { EquipmentSystemTypesService } from "./equipment-system-types.service";
import { CreateEquipmentSystemTypeDto } from "./dto/create-equipment-system-type.dto";
import { UpdateEquipmentSystemTypeStatusDto } from "./dto/update-equipment-system-type-status.dto";
import { Permissions } from "../../common/guards/permissions.decorator";
// No @UseGuards(PermissionsGuard) — see customers.controller.ts.

interface AuthedRequest extends Request {
  user: { userId: string };
}

function actorFrom(req: AuthedRequest) {
  return { userId: req.user.userId, ipAddress: req.ip, userAgent: req.get("user-agent") ?? undefined };
}

@Controller("equipment-system-types")
export class EquipmentSystemTypesController {
  constructor(private readonly equipmentSystemTypesService: EquipmentSystemTypesService) {}

  @Permissions({ module: "equipment_system_types", action: "read" })
  @Get()
  async list() {
    return this.equipmentSystemTypesService.list();
  }

  @Permissions({ module: "equipment_system_types", action: "manage" })
  @Post()
  async create(@Body() dto: CreateEquipmentSystemTypeDto, @Req() req: AuthedRequest) {
    return this.equipmentSystemTypesService.create(dto, actorFrom(req));
  }

  @Permissions({ module: "equipment_system_types", action: "manage" })
  @Patch(":code/status")
  async updateStatus(
    @Param("code") code: string,
    @Body() dto: UpdateEquipmentSystemTypeStatusDto,
    @Req() req: AuthedRequest,
  ) {
    return this.equipmentSystemTypesService.updateStatus(code, dto.status, actorFrom(req));
  }
}
