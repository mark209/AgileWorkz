import { Module } from "@nestjs/common";
import { ServiceReportVerificationService } from "./service-report-verification.service";
import { ServiceReportVerificationController } from "./service-report-verification.controller";
import { AuditModule } from "../audit/audit.module";
import { StorageModule } from "../../common/storage/storage.module";
import { IdentityModule } from "../identity/identity.module";

// Deliberately does NOT import ServiceReportsModule or ExtractionModule —
// this module reads/writes the extraction_* staging tables and
// service_reports header directly via its own PrismaService binding (the
// regular app_runtime client, never OcrWorkerPrismaService), same
// "no cross-module dependency for a shared table" precedent as
// ServiceReportsModule not importing CustomersModule.
@Module({
  imports: [AuditModule, StorageModule, IdentityModule],
  controllers: [ServiceReportVerificationController],
  providers: [ServiceReportVerificationService],
  exports: [ServiceReportVerificationService],
})
export class ServiceReportVerificationModule {}
