import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import * as path from "node:path";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { PrismaModule } from "./prisma/prisma.module";
import { IdentityModule } from "./modules/identity/identity.module";
import { SettingsModule } from "./modules/settings/settings.module";
import { AuditModule } from "./modules/audit/audit.module";
import { CustomersModule } from "./modules/customers/customers.module";
import { EquipmentReferenceModule } from "./modules/equipment-reference/equipment-reference.module";
import { EquipmentModule } from "./modules/equipment/equipment.module";
import { DocumentsModule } from "./modules/documents/documents.module";
import { SalesReferenceModule } from "./modules/sales-reference/sales-reference.module";
import { QuotationsModule } from "./modules/quotations/quotations.module";
import { WorkOrdersModule } from "./modules/work-orders/work-orders.module";
import { ServiceReportsModule } from "./modules/service-reports/service-reports.module";
import { ServiceReportVerificationModule } from "./modules/service-report-verification/service-report-verification.module";
import { ServiceReportConfirmationModule } from "./modules/service-report-confirmation/service-report-confirmation.module";
import { StorageModule } from "./common/storage/storage.module";
import { ExtractionModule } from "./common/extraction/extraction.module";
import { QueueModule } from "./common/queue/queue.module";
import { HealthController } from "./health/health.controller";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { PermissionsGuard } from "./common/guards/permissions.guard";
import { envValidationSchema } from "./config/env.validation";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      // .env lives at the repo root (one shared file for api/web/field), but
      // `pnpm --filter @agileworks/api ...` runs with cwd = apps/api, which
      // is NOT where dotenv's default lookup (process.cwd()) would find it.
      // Resolve relative to this module's own location instead, so it works
      // the same whether started from the repo root, apps/api, or dist/.
      envFilePath: path.resolve(__dirname, "..", "..", "..", ".env"),
    }),
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 100 }] }),
    PrismaModule,
    StorageModule,
    ExtractionModule,
    QueueModule,
    AuditModule,
    IdentityModule,
    SettingsModule,
    CustomersModule,
    EquipmentReferenceModule,
    EquipmentModule,
    DocumentsModule,
    SalesReferenceModule,
    QuotationsModule,
    WorkOrdersModule,
    ServiceReportsModule,
    ServiceReportVerificationModule,
    ServiceReportConfirmationModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: rate limiting first, then "are you logged in", then
    // "are you allowed to do this specific thing". Every one of these is
    // global — a route opts OUT via @Public(), never opts IN to being checked.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
