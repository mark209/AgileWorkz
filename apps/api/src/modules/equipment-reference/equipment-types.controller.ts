import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { EquipmentTypesService } from "./equipment-types.service";
import { CreateEquipmentTypeDto } from "./dto/create-equipment-type.dto";
import { UpdateEquipmentTypeStatusDto } from "./dto/update-equipment-type-status.dto";
import { Permissions } from "../../common/guards/permissions.decorator";
// No @UseGuards(PermissionsGuard) — see customers.controller.ts.

interface AuthedRequest extends Request {
  user: { userId: string };
}

function actorFrom(req: AuthedRequest) {
  return { userId: req.user.userId, ipAddress: req.ip, userAgent: req.get("user-agent") ?? undefined };
}

@Controller("equipment-types")
export class EquipmentTypesController {
  constructor(private readonly equipmentTypesService: EquipmentTypesService) {}

  @Permissions({ module: "equipment_types", action: "read" })
  @Get()
  async list() {
    return this.equipmentTypesService.list();
  }

  @Permissions({ module: "equipment_types", action: "manage" })
  @Post()
  async create(@Body() dto: CreateEquipmentTypeDto, @Req() req: AuthedRequest) {
    return this.equipmentTypesService.create(dto, actorFrom(req));
  }

  @Permissions({ module: "equipment_types", action: "manage" })
  @Patch(":code/status")
  async updateStatus(
    @Param("code") code: string,
    @Body() dto: UpdateEquipmentTypeStatusDto,
    @Req() req: AuthedRequest,
  ) {
    return this.equipmentTypesService.updateStatus(code, dto.status, actorFrom(req));
  }
}
