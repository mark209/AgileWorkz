import { Module } from "@nestjs/common";
import { WorkOrdersService } from "./work-orders.service";
import { WorkOrdersController } from "./work-orders.controller";
import { WorkOrderAssignmentsService } from "./work-order-assignments.service";
import { WorkOrderAssignmentsController } from "./work-order-assignments.controller";
import { AuditModule } from "../audit/audit.module";
import { NumberingModule } from "../../common/numbering/numbering.module";
import { IdentityModule } from "../identity/identity.module";
import { ServiceReportsModule } from "../service-reports/service-reports.module";

// Step 3. Deliberately does NOT import QuotationsModule or CustomersModule —
// WorkOrdersService talks to the `quotations`/`quotation_revisions`/
// `quotation_sections`/`quotation_line_items`/`quotation_testing_
// commissioning_items`/`customers`/`sites` tables directly via its own
// PrismaService binding (read-only for every Phase 3 table, matching
// QuotationsService's own precedent of reading `inquiries` directly rather
// than importing CustomersModule). QuotationsModule and CustomersModule
// both import this module instead (one direction only), so there is no
// circular dependency in either direction.
//
// Step 4 adds IdentityModule — WorkOrdersService.getForActor needs
// PermissionsService to resolve read vs. read_own (D4). IdentityModule only
// imports PassportModule/JwtModule/AuditModule, none of which touch this
// module, so this stays one-directional too.
//
// Phase 4 Operations Frontend adds ServiceReportsModule — unlike Quotations/
// Customers, ServiceReportsModule does NOT import WorkOrdersModule (it reads
// service_reports directly via its own PrismaService binding, same as this
// module does for quotations/customers), so importing it here is safe and
// one-directional. Needed so WorkOrdersController can reuse
// ServiceReportsService.listByWorkOrder() — specifically to reuse its
// existing toPublicServiceReport() projection (documentFileKey stripped)
// rather than re-deriving that same security-relevant transformation via a
// second, direct Prisma query here.
@Module({
  imports: [AuditModule, NumberingModule, IdentityModule, ServiceReportsModule],
  controllers: [WorkOrdersController, WorkOrderAssignmentsController],
  providers: [WorkOrdersService, WorkOrderAssignmentsService],
  exports: [WorkOrdersService],
})
export class WorkOrdersModule {}
