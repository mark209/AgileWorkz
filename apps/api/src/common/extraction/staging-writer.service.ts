import { Injectable } from "@nestjs/common";
import { ExtractionConfidence as DbExtractionConfidence, Prisma } from "@prisma/client";
import { OcrWorkerPrismaService } from "./ocr-worker-prisma.service";
import { RoutedFields, StagingRow, assignRowIndexes } from "./field-routing";
import { ExtractionConfidence } from "./extraction-provider.interface";

const CONFIDENCE_TO_DB: Record<ExtractionConfidence, DbExtractionConfidence> = {
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
  unreadable: "UNREADABLE",
};

/**
 * Writes extraction results into the six extraction_* staging tables, using
 * ONLY the ocr_worker-credentialed client — the database itself refuses
 * this code any access to a canonical service_report_* table, regardless of
 * what the code attempts (docs/architecture/ocr-worker-db-isolation.md).
 *
 * Idempotent by construction: each row is looked up by its natural key
 * (serviceReportId, rowIndex, fieldName[, stage]) via an explicit findFirst
 * before deciding to create or update — deliberately not a Prisma
 * upsert-by-compound-unique-key, because `stage` is nullable and standard
 * SQL treats NULL as distinct from NULL in a unique index, which would let
 * a re-run silently insert duplicate rows for the common (stage: null)
 * case instead of updating the existing one. All writes for one report run
 * inside a single transaction (§04a-8).
 */
@Injectable()
export class StagingWriterService {
  constructor(private readonly ocrPrisma: OcrWorkerPrismaService) {}

  async write(serviceReportId: string, routed: RoutedFields): Promise<void> {
    await this.ocrPrisma.$transaction(async (tx) => {
      await writeGenericRows(tx.extractionBasicInfo, serviceReportId, assignRowIndexes(routed.basicInfo));
      await writeGenericRows(tx.extractionEquipmentUnit, serviceReportId, assignRowIndexes(routed.equipmentUnit));
      await writeGenericRows(tx.extractionProblem, serviceReportId, assignRowIndexes(routed.problem));
      await writeMeasurementRows(tx, serviceReportId, assignRowIndexes(routed.measurement));
      await writeGenericRows(tx.extractionNarrativeItem, serviceReportId, assignRowIndexes(routed.narrativeItem));
      await writeGenericRows(tx.extractionSignoff, serviceReportId, assignRowIndexes(routed.signoff));
    });
  }
}

// Shared shape across extraction_basic_info / _equipment_units / _problems /
// _narrative_items / _signoffs — anything with a Prisma delegate exposing
// findFirst/create/update on this generic (serviceReportId, rowIndex,
// fieldName, aiValue, aiConfidence) shape.
interface GenericStagingDelegate {
  findFirst(args: { where: { serviceReportId: string; rowIndex: number; fieldName: string } }): Promise<{ id: string } | null>;
  create(args: { data: Prisma.InputJsonObject | Record<string, unknown> }): Promise<unknown>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
}

async function writeGenericRows(delegate: GenericStagingDelegate, serviceReportId: string, rows: StagingRow[]): Promise<void> {
  for (const row of rows) {
    const existing = await delegate.findFirst({
      where: { serviceReportId, rowIndex: row.rowIndex, fieldName: row.fieldName },
    });
    const data = {
      serviceReportId,
      rowIndex: row.rowIndex,
      fieldName: row.fieldName,
      aiValue: row.value,
      aiConfidence: CONFIDENCE_TO_DB[row.confidence],
      // Phase 5 Step 5 — AI-computed, refreshed on every extraction run
      // exactly like aiValue/aiConfidence. reviewStatus/verifiedValue/
      // verifiedBy/verifiedAt are deliberately absent from this object:
      // those are written only by the verification endpoint, and omitting
      // them here means a re-extraction never clobbers a human's prior
      // review decision on an existing row.
      requiresHumanVerification: row.requiresHumanVerification,
    };
    if (existing) {
      await delegate.update({ where: { id: existing.id }, data });
    } else {
      await delegate.create({ data });
    }
  }
}

async function writeMeasurementRows(
  tx: Prisma.TransactionClient,
  serviceReportId: string,
  rows: StagingRow[],
): Promise<void> {
  for (const row of rows) {
    const existing = await tx.extractionMeasurement.findFirst({
      where: { serviceReportId, rowIndex: row.rowIndex, fieldName: row.fieldName, stage: row.stage },
    });
    const data = {
      serviceReportId,
      rowIndex: row.rowIndex,
      fieldName: row.fieldName,
      stage: row.stage,
      aiValue: row.value,
      aiUnit: row.unit,
      aiConfidence: CONFIDENCE_TO_DB[row.confidence],
      suggestedMeasurementTypeCode: row.suggestedMeasurementTypeCode,
      requiresHumanVerification: row.requiresHumanVerification,
    };
    if (existing) {
      await tx.extractionMeasurement.update({ where: { id: existing.id }, data });
    } else {
      await tx.extractionMeasurement.create({ data });
    }
  }
}
