import { Body, Controller, Param, Patch, Req } from "@nestjs/common";
import { Request } from "express";
import { ContactsService } from "./contacts.service";
import { UpdateContactDto } from "./dto/update-contact.dto";
import { UpdateContactStatusDto } from "./dto/update-contact-status.dto";
import { Permissions } from "../../common/guards/permissions.decorator";
// No @UseGuards(PermissionsGuard) — see customers.controller.ts.

interface AuthedRequest extends Request {
  user: { userId: string };
}

function actorFrom(req: AuthedRequest) {
  return { userId: req.user.userId, ipAddress: req.ip, userAgent: req.get("user-agent") ?? undefined };
}

@Controller("contacts")
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Permissions({ module: "contacts", action: "update" })
  @Patch(":id")
  async update(@Param("id") id: string, @Body() dto: UpdateContactDto, @Req() req: AuthedRequest) {
    return this.contactsService.update(id, dto, actorFrom(req));
  }

  @Permissions({ module: "contacts", action: "deactivate" })
  @Patch(":id/status")
  async updateStatus(@Param("id") id: string, @Body() dto: UpdateContactStatusDto, @Req() req: AuthedRequest) {
    return this.contactsService.updateStatus(id, dto.status, actorFrom(req));
  }
}
