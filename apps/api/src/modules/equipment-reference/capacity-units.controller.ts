import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { CapacityUnitsService } from "./capacity-units.service";
import { CreateCapacityUnitDto } from "./dto/create-capacity-unit.dto";
import { UpdateCapacityUnitStatusDto } from "./dto/update-capacity-unit-status.dto";
import { Permissions } from "../../common/guards/permissions.decorator";
// No @UseGuards(PermissionsGuard) — see customers.controller.ts.

interface AuthedRequest extends Request {
  user: { userId: string };
}

function actorFrom(req: AuthedRequest) {
  return { userId: req.user.userId, ipAddress: req.ip, userAgent: req.get("user-agent") ?? undefined };
}

@Controller("capacity-units")
export class CapacityUnitsController {
  constructor(private readonly capacityUnitsService: CapacityUnitsService) {}

  @Permissions({ module: "capacity_units", action: "read" })
  @Get()
  async list() {
    return this.capacityUnitsService.list();
  }

  @Permissions({ module: "capacity_units", action: "manage" })
  @Post()
  async create(@Body() dto: CreateCapacityUnitDto, @Req() req: AuthedRequest) {
    return this.capacityUnitsService.create(dto, actorFrom(req));
  }

  @Permissions({ module: "capacity_units", action: "manage" })
  @Patch(":code/status")
  async updateStatus(
    @Param("code") code: string,
    @Body() dto: UpdateCapacityUnitStatusDto,
    @Req() req: AuthedRequest,
  ) {
    return this.capacityUnitsService.updateStatus(code, dto.status, actorFrom(req));
  }
}
