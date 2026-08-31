import { Module } from "@nestjs/common";
import { EquipmentSystemsService } from "./equipment-systems.service";
import { EquipmentSystemsController } from "./equipment-systems.controller";
import { AssetsService } from "./assets.service";
import { AssetsController } from "./assets.controller";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [AuditModule],
  controllers: [EquipmentSystemsController, AssetsController],
  providers: [EquipmentSystemsService, AssetsService],
  // Exported so SitesController (CustomersModule) can host the nested
  // GET/POST /sites/:id/equipment-systems and /sites/:id/assets routes,
  // the same "parent resource hosts the nested list/create" convention
  // already used for /customers/:id/contacts and /customers/:id/sites.
  exports: [EquipmentSystemsService, AssetsService],
})
export class EquipmentModule {}
