/**
 * Stage A single-document smoke test (Phase 5 Approved Baseline §04a,
 * Decision 1 checkpoint). Runs ONE real Service Report document through the
 * actual VertexGeminiExtractionProvider — no database writes, no storage
 * writes, no queue involvement, no change to the shared .env. Prints the
 * structured result for human review before any full scored acceptance
 * battery (Stage B, §04a-13) is run.
 *
 * This is a one-off developer tool, not part of `pnpm test`/`pnpm test:e2e`
 * — it is never invoked automatically and makes one real, billed call to
 * Vertex AI Gemini each time it runs.
 *
 * Requires ADC impersonation already configured locally (see the Phase 5
 * Approved Baseline §04a Decision 1 setup steps) — no key file, nothing
 * committed to this repo authenticates the call.
 *
 * Usage (from apps/api):
 *   pnpm exec ts-node -O '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/run-single-document-smoke-test.ts <path-to-file> [reportTypeCode]
 */

import * as path from "node:path";
import * as fs from "node:fs";
import * as dotenv from "dotenv";

// Only used to obtain DATABASE_URL for the read-only reference-table lookup
// below (the same app_runtime credential every other part of the app uses)
// — this script never writes to .env, and never reads/uses the Vertex AI
// config from it (see VERTEX_CONFIG below, passed explicitly instead).
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { PrismaService } from "../src/prisma/prisma.service";
import { ExtractionContextBuilder } from "../src/common/extraction/extraction-context.builder";
import { VertexGeminiExtractionProvider } from "../src/common/extraction/providers/vertex-gemini.provider";

// Approved Decision 1 configuration (Phase 5 Approved Baseline §04a) —
// passed explicitly, not read from .env, so this script's runs can never
// depend on (or accidentally change) EXTRACTION_PROVIDER in the shared
// .env file.
const VERTEX_CONFIG = {
  projectId: "agileworks-hvac-erp",
  region: "asia-southeast1",
  modelId: "gemini-2.5-flash",
};

const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

async function main() {
  const filePath = process.argv[2];
  const reportTypeCode = process.argv[3] ?? "INSTALLATION_COMMISSIONING";

  if (!filePath) {
    console.error("Usage: run-single-document-smoke-test.ts <path-to-file> [reportTypeCode]");
    process.exit(1);
  }

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  const extension = path.extname(resolvedPath).toLowerCase();
  const mimeType = MIME_TYPES_BY_EXTENSION[extension];
  if (!mimeType) {
    console.error(`Unsupported extension for this smoke test: ${extension}`);
    process.exit(1);
  }

  const content = fs.readFileSync(resolvedPath);
  console.log(`Loaded ${resolvedPath} (${content.length} bytes, ${mimeType})`);

  const prisma = new PrismaService();
  await prisma.$connect();

  try {
    const contextBuilder = new ExtractionContextBuilder(prisma);
    const context = await contextBuilder.build(reportTypeCode);
    console.log(
      `Context built for reportTypeCode=${reportTypeCode}: ` +
        `${context.allowedMeasurementTypes.length} measurement types, ` +
        `${context.allowedMeasurementStages.length} stages, ` +
        `${context.allowedProblemTypes.length} problem types, ` +
        `${context.allowedSignoffRoles.length} signoff roles.`,
    );

    const provider = new VertexGeminiExtractionProvider(VERTEX_CONFIG);

    console.log("Calling Vertex AI Gemini (asia-southeast1, gemini-2.5-flash) — one real, billed API call...");
    const startedAt = Date.now();
    const result = await provider.extractDocument({ content, mimeType, pageCount: 1 }, context);
    const elapsedMs = Date.now() - startedAt;

    console.log(`\n=== RESULT — status: ${result.status}, wall-clock: ${elapsedMs}ms ===`);
    if (result.error) console.log(`Error: ${result.error}`);
    console.log("Provider metadata:", result.providerMetadata);
    console.log(`Field count: ${result.fields.length}\n`);
    console.log(JSON.stringify(result.fields, null, 2));

    const outPath = path.resolve(process.env.TEMP ?? process.env.TMPDIR ?? ".", "smoke-test-result.json");
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log(`\nFull result also written to: ${outPath}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
