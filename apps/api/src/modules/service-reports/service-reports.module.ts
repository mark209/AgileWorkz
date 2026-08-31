import { Module } from "@nestjs/common";
import { ServiceReportsService } from "./service-reports.service";
import { ServiceReportsController } from "./service-reports.controller";
import { AuditModule } from "../audit/audit.module";
import { StorageModule } from "../../common/storage/storage.module";
import { ExtractionModule } from "../../common/extraction/extraction.module";
import { NumberingModule } from "../../common/numbering/numbering.module";
import { IdentityModule } from "../identity/identity.module";

// Deliberately does NOT import CustomersModule — ServiceReportsService
// validates customer/site/work-order existence directly via its own
// PrismaService binding, same precedent as WorkOrdersModule reading
// customers/sites directly rather than importing CustomersModule.
// CustomersModule imports THIS module instead (one direction only, so no
// circular dependency) to reach ServiceReportsService for the nested
// POST /customers/:id/service-reports upload route.
@Module({
  imports: [AuditModule, StorageModule, ExtractionModule, NumberingModule, IdentityModule],
  controllers: [ServiceReportsController],
  providers: [ServiceReportsService],
  exports: [ServiceReportsService],
})
export class ServiceReportsModule {}
