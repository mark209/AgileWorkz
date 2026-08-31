/**
 * Stage C adaptive-pipeline validation batch runner (Phase 5 Stage C
 * correction plan). Runs each of the same 4 Stage B acceptance documents
 * ONCE through AdaptiveExtractionService — not the raw provider directly —
 * so the adaptive pipeline's own internal escalation decision (1 call vs.
 * up to 3, per document) is exercised exactly as production will use it.
 * This is a deliberately different execution shape than Stage B's flat "3
 * runs always": the whole point of Stage C is that most documents should
 * no longer need 3 calls, so forcing 3 runs here would defeat the point of
 * what's being measured.
 *
 * No database writes, no storage writes, no queue involvement, no change
 * to the shared .env — same isolation as the Stage A/B scripts.
 *
 * Usage (from apps/api):
 *   pnpm exec ts-node -O '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/run-stage-c-batch.ts
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

interface StageCDocument {
  id: string;
  filePath: string;
  reportTypeCode: string;
  mimeType: string;
  classification: "final-acceptance" | "external-layout-validation";
}

// Identical 4 documents, same classification, as Stage B — see
// run-stage-b-batch.ts. Re-listed here rather than imported so this script
// stays a standalone, independently-readable artifact like its Stage B
// counterpart.
const DOCUMENTS: StageCDocument[] = [
  {
    id: "bayshore",
    filePath: "C:/Users/Joy Ann/Downloads/12FLR Bayshore Start Up report.pdf",
    reportTypeCode: "INSTALLATION_COMMISSIONING",
    mimeType: "application/pdf",
    classification: "final-acceptance",
  },
  {
    id: "vrv1",
    filePath: "C:/Users/Joy Ann/Downloads/AGILE WORKS START UP REPORT VRV SYSTEM 1.pdf",
    reportTypeCode: "INSTALLATION_COMMISSIONING",
    mimeType: "application/pdf",
    classification: "final-acceptance",
  },
  {
    id: "biomic",
    filePath: "C:/Users/Joy Ann/Downloads/service report sm retail.pdf",
    reportTypeCode: "GENERAL_SERVICE_REPAIR",
    mimeType: "application/pdf",
    classification: "external-layout-validation",
  },
  {
    id: "uptwn",
    filePath: "C:/Users/Joy Ann/Downloads/UPTWN SERVICE REPORT.pdf",
    reportTypeCode: "GENERAL_SERVICE_REPAIR",
    mimeType: "application/pdf",
    classification: "external-layout-validation",
  },
];

interface StageCRunRecord {
  documentId: string;
  classification: string;
  result: AdaptiveExtractionResult;
  estimatedCostUsd: number;
}

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  const contextBuilder = new ExtractionContextBuilder(prisma);
  const provider = new VertexGeminiExtractionProvider(VERTEX_CONFIG);
  const adaptiveExtraction = new AdaptiveExtractionService(provider);

  const records: StageCRunRecord[] = [];

  try {
    const contextCache = new Map<string, Awaited<ReturnType<typeof contextBuilder.build>>>();

    for (const doc of DOCUMENTS) {
      if (!fs.existsSync(doc.filePath)) {
        console.error(`MISSING FILE, skipping: ${doc.filePath}`);
        continue;
      }
      const content = fs.readFileSync(doc.filePath);
      console.log(`\n=== ${doc.id} (${doc.classification}) — ${content.length} bytes ===`);

      if (!contextCache.has(doc.reportTypeCode)) {
        contextCache.set(doc.reportTypeCode, await contextBuilder.build(doc.reportTypeCode));
      }
      const context = contextCache.get(doc.reportTypeCode)!;

      console.log(`  running adaptive pipeline...`);
      const result = await adaptiveExtraction.extract({ content, mimeType: doc.mimeType }, context);
      const estimatedCostUsd = estimateCostUsd(result.totalUsage);
      console.log(
        `  done — status=${result.status} fields=${result.fields.length} callsUsed=${result.callsUsed} ` +
          `triggers=[${result.verificationTriggers.map((t) => t.reason).join(", ")}] ` +
          `totalLatencyMs=${result.totalLatencyMs} totalTokens=${result.totalUsage.totalTokenCount} ` +
          `estimatedCostUsd=${estimatedCostUsd.toFixed(5)}`,
      );
      records.push({ documentId: doc.id, classification: doc.classification, result, estimatedCostUsd });
    }
  } finally {
    await prisma.$disconnect();
  }

  const outPath = path.resolve(process.env.TEMP ?? process.env.TMPDIR ?? ".", "stage-c-results.json");
  fs.writeFileSync(outPath, JSON.stringify(records, null, 2));
  console.log(`\nAll runs complete. ${records.length} records written to: ${outPath}`);
}

main().catch((err) => {
  console.error("Stage C batch run failed:", err);
  process.exit(1);
});
