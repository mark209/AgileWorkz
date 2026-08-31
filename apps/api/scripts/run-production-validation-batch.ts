/**
 * Phase 5 production-representative validation (Stage C.1 sign-off). Runs
 * the COMPLETE 21-document real AgileWorks Solutions OPC corpus (Service
 * Reports + Maintenance Reports, provided directly by the user, distinct
 * from the Stage B/C Bayshore/VRV1/Biomic/UPTWN documents) through
 * AdaptiveExtractionService exactly as currently implemented — no code
 * changes for this run. 1 adaptive-pipeline invocation per document; the
 * pipeline itself decides 1 vs. up to 3 Gemini calls per document.
 *
 * No database writes, no storage writes, no queue involvement, no change
 * to the shared .env — same isolation as the Stage A/B/C scripts.
 *
 * Usage (from apps/api):
 *   pnpm exec ts-node -O '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/run-production-validation-batch.ts
 */

import * as path from "node:path";
import * as fs from "node:fs";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { PrismaService } from "../src/prisma/prisma.service";
import { ExtractionContextBuilder } from "../src/common/extraction/extraction-context.builder";
import { VertexGeminiExtractionProvider } from "../src/common/extraction/providers/vertex-gemini.provider";
import { AdaptiveExtractionService } from "../src/common/extraction/adaptive-extraction.service";
import { estimateCostUsd } from "../src/common/extraction/adaptive-extraction.types";
import { AdaptiveExtractionResult } from "../src/common/extraction/adaptive-extraction.types";

const VERTEX_CONFIG = {
  projectId: "agileworks-hvac-erp",
  region: "asia-southeast1",
  modelId: "gemini-2.5-flash",
};

const FOLDER = "C:/Users/Joy Ann/Downloads/Neil Personal Files/AgileWorks Solutions OPC";

interface ProdDocument {
  id: string; // report number, for readability in output
  fileName: string;
  reportTypeCode: "MAINTENANCE_CLEANING" | "GENERAL_SERVICE_REPAIR" | "INSTALLATION_COMMISSIONING";
}

// The full 21-document production-validation corpus, classified per the
// user's explicit instructions in this conversation:
//  - "Service Report" template: PMS/Cleaning -> MAINTENANCE_CLEANING,
//    Repair/diagnosis -> GENERAL_SERVICE_REPAIR, new install ->
//    INSTALLATION_COMMISSIONING.
//  - "Maintenance Report" template: always MAINTENANCE_CLEANING (bulk
//    multi-unit cleaning with technical parameters).
//  - SR 0273 (monitoring-only) and SR 0275 (pre-install survey): per the
//    user's explicit instruction, classified MAINTENANCE_CLEANING.
const DOCUMENTS: ProdDocument[] = [
  { id: "MR0101", fileName: "WhatsApp Image 2026-08-29 at 9.34.19 AM.jpeg", reportTypeCode: "MAINTENANCE_CLEANING" },
  { id: "MR0102", fileName: "WhatsApp Image 2026-08-29 at 9.34.20 AM.jpeg", reportTypeCode: "MAINTENANCE_CLEANING" },
  { id: "MR0153", fileName: "WhatsApp Image 2026-08-20 at 7.35.53 AM.jpeg", reportTypeCode: "MAINTENANCE_CLEANING" },
  { id: "SR0106", fileName: "WhatsApp Image 2026-08-20 at 7.35.54 AM.jpeg", reportTypeCode: "MAINTENANCE_CLEANING" },
  { id: "SR0109", fileName: "WhatsApp Image 2026-08-29 at 9.41.48 AM.jpeg", reportTypeCode: "MAINTENANCE_CLEANING" },
  { id: "SR0112", fileName: "WhatsApp Image 2026-08-29 at 9.45.30 AM3.jpeg", reportTypeCode: "GENERAL_SERVICE_REPAIR" },
  { id: "SR0114", fileName: "WhatsApp Image 2026-08-29 at 9.45.30 AM2.jpeg", reportTypeCode: "MAINTENANCE_CLEANING" },
  { id: "SR0115", fileName: "WhatsApp Image 2026-08-29 at 9.45.26 AM.jpeg", reportTypeCode: "MAINTENANCE_CLEANING" },
  { id: "SR0116", fileName: "WhatsApp Image 2026-08-29 at 9.43.45 AM.jpeg", reportTypeCode: "GENERAL_SERVICE_REPAIR" },
  { id: "SR0118", fileName: "WhatsApp Image 2026-08-28 at 10.35.51 PM.jpeg", reportTypeCode: "MAINTENANCE_CLEANING" },
  { id: "SR0119", fileName: "WhatsApp Image 2026-08-29 at 8.13.37 AM.jpeg", reportTypeCode: "MAINTENANCE_CLEANING" },
  { id: "SR0201", fileName: "WhatsApp Image 2026-08-29 at 9.34.20 AM1.jpeg", reportTypeCode: "GENERAL_SERVICE_REPAIR" },
  { id: "SR0252", fileName: "WhatsApp Image 2026-06-23 at 3.19.49 PM.jpeg", reportTypeCode: "GENERAL_SERVICE_REPAIR" },
  { id: "SR0273", fileName: "WhatsApp Image 2026-08-29 at 9.45.28 AM1.jpeg", reportTypeCode: "MAINTENANCE_CLEANING" },
  { id: "SR0275", fileName: "WhatsApp Image 2026-08-29 at 9.45.28 AM2.jpeg", reportTypeCode: "MAINTENANCE_CLEANING" },
  { id: "SR0276", fileName: "WhatsApp Image 2026-08-29 at 9.45.28 AM3.jpeg", reportTypeCode: "GENERAL_SERVICE_REPAIR" },
  { id: "SR0277", fileName: "WhatsApp Image 2026-08-29 at 9.45.29 AM5.jpeg", reportTypeCode: "MAINTENANCE_CLEANING" },
  { id: "SR0278", fileName: "WhatsApp Image 2026-08-29 at 9.45.29 AM.jpeg", reportTypeCode: "MAINTENANCE_CLEANING" },
  { id: "SR0279", fileName: "WhatsApp Image 2026-08-29 at 9.45.29 AM1.jpeg", reportTypeCode: "MAINTENANCE_CLEANING" },
  { id: "SR0368", fileName: "WhatsApp Image 2026-08-29 at 9.45.27 AM.jpeg", reportTypeCode: "INSTALLATION_COMMISSIONING" },
  { id: "SR0369", fileName: "WhatsApp Image 2026-08-29 at 9.45.28 AM.jpeg", reportTypeCode: "INSTALLATION_COMMISSIONING" },
];

interface ProdRunRecord {
  documentId: string;
  reportTypeCode: string;
  result: AdaptiveExtractionResult;
  estimatedCostUsd: number;
}

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  const contextBuilder = new ExtractionContextBuilder(prisma);
  const provider = new VertexGeminiExtractionProvider(VERTEX_CONFIG);
  const adaptiveExtraction = new AdaptiveExtractionService(provider);

  const records: ProdRunRecord[] = [];

  try {
    const contextCache = new Map<string, Awaited<ReturnType<typeof contextBuilder.build>>>();

    for (const doc of DOCUMENTS) {
      const filePath = path.join(FOLDER, doc.fileName);
      if (!fs.existsSync(filePath)) {
        console.error(`MISSING FILE, skipping: ${filePath}`);
        continue;
      }
      const content = fs.readFileSync(filePath);
      console.log(`\n=== ${doc.id} (${doc.reportTypeCode}) — ${content.length} bytes ===`);

      if (!contextCache.has(doc.reportTypeCode)) {
        contextCache.set(doc.reportTypeCode, await contextBuilder.build(doc.reportTypeCode));
      }
      const context = contextCache.get(doc.reportTypeCode)!;

      console.log(`  running adaptive pipeline...`);
      const result = await adaptiveExtraction.extract({ content, mimeType: "image/jpeg" }, context);
      const estimatedCostUsd = estimateCostUsd(result.totalUsage);
      console.log(
        `  done — status=${result.status} fields=${result.fields.length} callsUsed=${result.callsUsed} ` +
          `triggers=[${result.verificationTriggers.map((t) => t.reason).join(", ")}] ` +
          `totalLatencyMs=${result.totalLatencyMs} totalTokens=${result.totalUsage.totalTokenCount} ` +
          `estimatedCostUsd=${estimatedCostUsd.toFixed(5)}`,
      );
      records.push({ documentId: doc.id, reportTypeCode: doc.reportTypeCode, result, estimatedCostUsd });
    }
  } finally {
    await prisma.$disconnect();
  }

  const outPath = path.resolve(process.env.TEMP ?? process.env.TMPDIR ?? ".", "production-validation-results.json");
  fs.writeFileSync(outPath, JSON.stringify(records, null, 2));
  console.log(`\nAll runs complete. ${records.length} records written to: ${outPath}`);
}

main().catch((err) => {
  console.error("Production validation batch run failed:", err);
  process.exit(1);
});
