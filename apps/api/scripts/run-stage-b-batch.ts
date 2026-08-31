/**
 * Stage B multi-document acceptance-test batch runner (Phase 5 Approved
 * Baseline §04a-13, Stage B). Runs each approved document 3 times through
 * the real VertexGeminiExtractionProvider and saves every raw result
 * (fields + providerMetadata, including token usage/latency) to one JSON
 * file for offline analysis. No database writes, no storage writes, no
 * queue involvement, no change to the shared .env — same isolation as the
 * Stage A single-document script.
 *
 * Usage (from apps/api):
 *   pnpm exec ts-node -O '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/run-stage-b-batch.ts
 */

import * as path from "node:path";
import * as fs from "node:fs";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { PrismaService } from "../src/prisma/prisma.service";
import { ExtractionContextBuilder } from "../src/common/extraction/extraction-context.builder";
import { VertexGeminiExtractionProvider } from "../src/common/extraction/providers/vertex-gemini.provider";
import { ExtractionBatchResult } from "../src/common/extraction/extraction-provider.interface";

const VERTEX_CONFIG = {
  projectId: "agileworks-hvac-erp",
  region: "asia-southeast1",
  modelId: "gemini-2.5-flash",
};

const RUNS_PER_DOCUMENT = 3;

interface StageBDocument {
  id: string;
  filePath: string;
  reportTypeCode: string;
  mimeType: string;
  classification: "final-acceptance" | "external-layout-validation";
}

const DOCUMENTS: StageBDocument[] = [
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

interface StageBRunRecord {
  documentId: string;
  classification: string;
  runIndex: number;
  result: ExtractionBatchResult;
}

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  const contextBuilder = new ExtractionContextBuilder(prisma);
  const provider = new VertexGeminiExtractionProvider(VERTEX_CONFIG);

  const records: StageBRunRecord[] = [];

  try {
    // Cache context per reportTypeCode — both documents of a given
    // classification share one, no need to rebuild per run.
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

      for (let runIndex = 1; runIndex <= RUNS_PER_DOCUMENT; runIndex++) {
        console.log(`  run ${runIndex}/${RUNS_PER_DOCUMENT} — calling Vertex AI...`);
        const result = await provider.extractDocument({ content, mimeType: doc.mimeType }, context);
        console.log(
          `  run ${runIndex} done — status=${result.status} fields=${result.fields.length} ` +
            `latencyMs=${result.providerMetadata?.latencyMs} totalTokens=${result.providerMetadata?.usage?.totalTokenCount}`,
        );
        records.push({ documentId: doc.id, classification: doc.classification, runIndex, result });
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  const outPath = path.resolve(process.env.TEMP ?? process.env.TMPDIR ?? ".", "stage-b-results.json");
  fs.writeFileSync(outPath, JSON.stringify(records, null, 2));
  console.log(`\nAll runs complete. ${records.length} records written to: ${outPath}`);
}

main().catch((err) => {
  console.error("Stage B batch run failed:", err);
  process.exit(1);
});
