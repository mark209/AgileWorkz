import { Module } from "@nestjs/common";
import { TradesService } from "./trades.service";
import { TradesController } from "./trades.controller";
import { InquirySourcesService } from "./inquiry-sources.service";
import { InquirySourcesController } from "./inquiry-sources.controller";
import { InquiryTypesService } from "./inquiry-types.service";
import { InquiryTypesController } from "./inquiry-types.controller";
import { QuotationTermTemplatesService } from "./quotation-term-templates.service";
import { QuotationTermTemplatesController } from "./quotation-term-templates.controller";
import { AuditModule } from "../audit/audit.module";

// Step 4 — the four reference-table modules the approved Phase 3 plan
// scoped together (§14 Step 4: "Trades + Quotation Templates reference
// modules — built first, since quotations depend on them for valid FK
// values"), extended to also cover inquiry_sources/inquiry_types (Step 3
// correction created their tables/seed data but deferred their API to this
// step). Same reference-table CRUD/status pattern as Phase 2's
// EquipmentReferenceModule throughout — no new pattern introduced.
@Module({
  imports: [AuditModule],
  controllers: [TradesController, InquirySourcesController, InquiryTypesController, QuotationTermTemplatesController],
  providers: [TradesService, InquirySourcesService, InquiryTypesService, QuotationTermTemplatesService],
  exports: [TradesService, InquirySourcesService, InquiryTypesService, QuotationTermTemplatesService],
})
export class SalesReferenceModule {}
