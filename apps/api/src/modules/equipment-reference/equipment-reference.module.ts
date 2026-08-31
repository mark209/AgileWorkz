import { Module } from "@nestjs/common";
import { EquipmentTypesService } from "./equipment-types.service";
import { EquipmentTypesController } from "./equipment-types.controller";
import { EquipmentSystemTypesService } from "./equipment-system-types.service";
import { EquipmentSystemTypesController } from "./equipment-system-types.controller";
import { CapacityUnitsService } from "./capacity-units.service";
import { CapacityUnitsController } from "./capacity-units.controller";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [AuditModule],
  controllers: [EquipmentTypesController, EquipmentSystemTypesController, CapacityUnitsController],
  providers: [EquipmentTypesService, EquipmentSystemTypesService, CapacityUnitsService],
  exports: [EquipmentTypesService, EquipmentSystemTypesService, CapacityUnitsService],
})
export class EquipmentReferenceModule {}
