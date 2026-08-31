import { Module } from "@nestjs/common";
import { CustomersService } from "./customers.service";
import { CustomersController } from "./customers.controller";
import { ContactsService } from "./contacts.service";
import { ContactsController } from "./contacts.controller";
import { SitesService } from "./sites.service";
import { SitesController } from "./sites.controller";
import { InquiriesService } from "./inquiries.service";
import { InquiriesController } from "./inquiries.controller";
import { AuditModule } from "../audit/audit.module";
import { EquipmentModule } from "../equipment/equipment.module";
import { NumberingModule } from "../../common/numbering/numbering.module";
import { QuotationsModule } from "../quotations/quotations.module";
import { WorkOrdersModule } from "../work-orders/work-orders.module";
import { ServiceReportsModule } from "../service-reports/service-reports.module";

@Module({
  // EquipmentModule is imported (not just its services provided directly)
  // so SitesController can inject EquipmentSystemsService/AssetsService for
  // the nested /sites/:id/equipment-systems and /sites/:id/assets routes —
  // EquipmentModule doesn't import CustomersModule back, so this stays a
  // one-directional dependency, no cycle. NumberingModule (Step 3
  // correction) is imported so InquiriesService can generate INQ-... numbers.
  // QuotationsModule (Step 5) is imported so CustomersController can create
  // quotations directly and InquiriesController can convert an inquiry into
  // one — QuotationsModule never imports CustomersModule back (see its own
  // module comment), so this stays one-directional too. WorkOrdersModule
  // (Phase 4 Step 3) is imported so CustomersController can create/list
  // standalone Work Orders (Path B) — WorkOrdersModule never imports
  // CustomersModule back either. ServiceReportsModule (Phase 5 Step 4) is
  // imported for the same reason, for the nested
  // POST /customers/:id/service-reports upload route — it doesn't import
  // CustomersModule back either.
  imports: [AuditModule, EquipmentModule, NumberingModule, QuotationsModule, WorkOrdersModule, ServiceReportsModule],
  controllers: [CustomersController, ContactsController, SitesController, InquiriesController],
  providers: [CustomersService, ContactsService, SitesService, InquiriesService],
  exports: [CustomersService, ContactsService, SitesService, InquiriesService],
})
export class CustomersModule {}
