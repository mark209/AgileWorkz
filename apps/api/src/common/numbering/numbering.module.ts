import { Module } from "@nestjs/common";
import { NumberingService } from "./numbering.service";

// Shared numbering engine (Step 3 correction) — generalized from the
// original quotation-only design so Step 5's Quotations module can reuse
// the exact same service/table for QT-... numbers instead of duplicating
// this logic.
@Module({
  providers: [NumberingService],
  exports: [NumberingService],
})
export class NumberingModule {}
