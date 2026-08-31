import { Module } from "@nestjs/common";
import { ServiceReportConfirmationService } from "./service-report-confirmation.service";
import { ServiceReportConfirmationController } from "./service-report-confirmation.controller";
import { ConfirmationPlanBuilderService } from "./confirmation-plan-builder.service";
import { AuditModule } from "../audit/audit.module";

// Deliberately does NOT import ServiceReportsModule or
// ServiceReportVerificationModule — reads/writes the extraction_* staging
// tables, the service_reports header, and the six canonical
// service_report_* detail tables directly via its own PrismaService
// binding, same "no cross-module dependency for a shared table" precedent
// already established by ServiceReportVerificationModule.
@Module({
  imports: [AuditModule],
  controllers: [ServiceReportConfirmationController],
  providers: [ServiceReportConfirmationService, ConfirmationPlanBuilderService],
  exports: [ServiceReportConfirmationService],
})
export class ServiceReportConfirmationModule {}
