import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { TradesService } from "./trades.service";
import { CreateTradeDto } from "./dto/create-trade.dto";
import { UpdateTradeStatusDto } from "./dto/update-trade-status.dto";
import { Permissions } from "../../common/guards/permissions.decorator";
// No @UseGuards(PermissionsGuard) — see customers.controller.ts.

interface AuthedRequest extends Request {
  user: { userId: string };
}

function actorFrom(req: AuthedRequest) {
  return { userId: req.user.userId, ipAddress: req.ip, userAgent: req.get("user-agent") ?? undefined };
}

@Controller("trades")
export class TradesController {
  constructor(private readonly tradesService: TradesService) {}

  @Permissions({ module: "trades", action: "read" })
  @Get()
  async list() {
    return this.tradesService.list();
  }

  @Permissions({ module: "trades", action: "manage" })
  @Post()
  async create(@Body() dto: CreateTradeDto, @Req() req: AuthedRequest) {
    return this.tradesService.create(dto, actorFrom(req));
  }

  @Permissions({ module: "trades", action: "manage" })
  @Patch(":code/status")
  async updateStatus(@Param("code") code: string, @Body() dto: UpdateTradeStatusDto, @Req() req: AuthedRequest) {
    return this.tradesService.updateStatus(code, dto.status, actorFrom(req));
  }
}
