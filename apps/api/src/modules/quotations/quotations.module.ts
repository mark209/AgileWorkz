import { Module } from "@nestjs/common";
import { QuotationsService } from "./quotations.service";
import { QuotationsController } from "./quotations.controller";
import { QuotationSectionsService } from "./quotation-sections.service";
import { QuotationSectionsController } from "./quotation-sections.controller";
import { QuotationLineItemsService } from "./quotation-line-items.service";
import { QuotationLineItemsController } from "./quotation-line-items.controller";
import { QuotationMaintenanceDetailsService } from "./quotation-maintenance-details.service";
import { QuotationMaintenanceDetailsController } from "./quotation-maintenance-details.controller";
import { QuotationTestingCommissioningItemsService } from "./quotation-testing-commissioning-items.service";
import { QuotationTestingCommissioningItemsController } from "./quotation-testing-commissioning-items.controller";
import { QuotationPricingService } from "./pricing/quotation-pricing.service";
import { AuditModule } from "../audit/audit.module";
import { NumberingModule } from "../../common/numbering/numbering.module";
import { WorkOrdersModule } from "../work-orders/work-orders.module";

// Step 5. Deliberately does NOT import CustomersModule (which owns
// InquiriesController/InquiriesService) — QuotationsService talks to the
// `inquiries` table directly via its own PrismaService binding for the
// conversion flow's atomic status flip, so there is no need for, and no
// risk of, a circular module dependency. CustomersModule imports this
// module instead (one direction only), the same way it already imports
// EquipmentModule and NumberingModule.
//
// Step 6 adds the revision-content layer (sections, line items, maintenance
// details, testing/commissioning items) and QuotationPricingService, the
// shared calculation engine every one of those (except sections, which are
// pricing-neutral) triggers after a mutation.
// Phase 4 Step 3 — WorkOrdersModule is imported so QuotationsController can
// expose the ACCEPTED-revision -> Work Order conversion route directly on
// its own natural URL (§05: "spawning a Work Order is explicitly the one
// thing an ACCEPTED revision is for"). WorkOrdersModule never imports this
// module back (see its own module comment), so this stays one-directional.
@Module({
  imports: [AuditModule, NumberingModule, WorkOrdersModule],
  controllers: [
    QuotationsController,
    QuotationSectionsController,
    QuotationLineItemsController,
    QuotationMaintenanceDetailsController,
    QuotationTestingCommissioningItemsController,
  ],
  providers: [
    QuotationsService,
    QuotationSectionsService,
    QuotationLineItemsService,
    QuotationMaintenanceDetailsService,
    QuotationTestingCommissioningItemsService,
    QuotationPricingService,
  ],
  exports: [QuotationsService],
})
export class QuotationsModule {}
