import { Injectable } from "@nestjs/common";
import { NumberSeries, Prisma } from "@prisma/client";
import { currentManilaYearMonth } from "./manila-time.util";

const DEFAULT_PREFIXES: Record<NumberSeries, string> = {
  INQUIRY: "INQ",
  QUOTATION: "QT",
  // Phase 4 Step 1 — WO-YYYY-MM-NNNNN (D9). The real system_settings row
  // (work_order_number_prefix) is seeded in Step 2; this fallback keeps the
  // engine correct even before that seed runs, same as every other series.
  WORK_ORDER: "WO",
  // Phase 5 Step 1 — SR-YYYY-MM-NNNNN, same 5-digit engine, same fallback
  // pattern. The real system_settings row (service_report_number_prefix) is
  // deferred to Step 2, matching every prior phase's own numbering rollout.
  SERVICE_REPORT: "SR",
};

const PREFIX_SETTING_KEYS: Record<NumberSeries, string> = {
  INQUIRY: "inquiry_number_prefix",
  QUOTATION: "quotation_number_prefix",
  WORK_ORDER: "work_order_number_prefix",
  SERVICE_REPORT: "service_report_number_prefix",
};

@Injectable()
export class NumberingService {
  /**
   * Generates the next number in `series` for the current Asia/Manila
   * calendar month — e.g. INQ-2026-08-00001. Must be called with the same
   * transaction client (`tx`) used to insert the row that consumes the
   * returned number, so a rollback never leaves a number issued-then-
   * abandoned (approved plan §05a, generalized to any series in the Step 3
   * correction — originally quotation-only, now shared).
   *
   * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` handles both "first
   * number issued this month for this series" and "Nth number" in one
   * atomic statement — Postgres row-locks the (series, year, month) counter
   * row for the statement's duration, so concurrent callers genuinely
   * serialize rather than racing on a stale read, with no separate "does
   * this month's row exist yet" check-then-act race to get wrong.
   */
  async generateNumber(tx: Prisma.TransactionClient, series: NumberSeries): Promise<string> {
    const { year, month } = currentManilaYearMonth();
    const prefix = await this.resolvePrefix(tx, series);

    const rows = await tx.$queryRaw<Array<{ last_sequence: number }>>`
      INSERT INTO "document_number_counters" ("series", "year", "month", "last_sequence", "updated_at")
      VALUES (${series}::"NumberSeries", ${year}, ${month}, 1, now())
      ON CONFLICT ("series", "year", "month")
      DO UPDATE SET "last_sequence" = "document_number_counters"."last_sequence" + 1, "updated_at" = now()
      RETURNING "last_sequence";
    `;

    const sequence = rows[0].last_sequence;
    const paddedMonth = String(month).padStart(2, "0");
    const paddedSequence = String(sequence).padStart(5, "0");
    return `${prefix}-${year}-${paddedMonth}-${paddedSequence}`;
  }

  // Prefix is configurable per series via system_settings but is NOT part
  // of the counter's own scope key — changing a prefix mid-month never
  // forks a series into a parallel sequence (approved plan §05a). Falls
  // back to the series' documented default if the setting row is somehow
  // missing, rather than failing inquiry/quotation creation over it.
  private async resolvePrefix(tx: Prisma.TransactionClient, series: NumberSeries): Promise<string> {
    const setting = await tx.systemSetting.findUnique({ where: { key: PREFIX_SETTING_KEYS[series] } });
    return setting?.value ?? DEFAULT_PREFIXES[series];
  }
}
