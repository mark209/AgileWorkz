/**
 * Standalone acceptance-test harness (Phase 5 Approved Baseline §04a-13).
 * Exercises an ExtractionProvider directly — no queue, no database, no
 * Upload API — so provider extraction quality can be measured in isolation
 * before the queue processor exists. Point this at
 * VertexGeminiExtractionProvider with real sample-form fixtures and
 * credentials once those exist; until then it is exercised in tests only
 * against a fake in-memory provider (test/run-acceptance-test.spec.ts).
 */

import { ExtractionContext, ExtractionDocumentInput, ExtractionProvider } from "../extraction-provider.interface";
import { GroundTruthDocument } from "./ground-truth.types";
import {
  AcceptanceCounts,
  AcceptanceEvaluationRow,
  evaluateAgainstTargets,
  mergeCounts,
  scoreDocument,
  toRates,
} from "./scoring";

export interface AcceptanceTestCase {
  document: ExtractionDocumentInput;
  context: ExtractionContext;
  groundTruth: GroundTruthDocument;
}

export interface AcceptanceTestCaseResult {
  documentId: string;
  status: "extracted" | "partial" | "failed";
  error?: string;
  latencyMs?: number;
  counts: AcceptanceCounts;
}

export interface AcceptanceTestReport {
  caseResults: AcceptanceTestCaseResult[];
  overallCounts: AcceptanceCounts;
  evaluation: AcceptanceEvaluationRow[];
  latency: { p50Ms: number | null; p95Ms: number | null };
}

function percentile(sortedAscending: number[], p: number): number | null {
  if (sortedAscending.length === 0) {
    return null;
  }
  const index = Math.min(sortedAscending.length - 1, Math.ceil((p / 100) * sortedAscending.length) - 1);
  return sortedAscending[Math.max(0, index)];
}

export async function runAcceptanceTest(provider: ExtractionProvider, cases: AcceptanceTestCase[]): Promise<AcceptanceTestReport> {
  const caseResults: AcceptanceTestCaseResult[] = [];
  const latencies: number[] = [];

  for (const testCase of cases) {
    const result = await provider.extractDocument(testCase.document, testCase.context);
    const counts = scoreDocument(result.fields, testCase.groundTruth);
    if (result.providerMetadata?.latencyMs !== undefined) {
      latencies.push(result.providerMetadata.latencyMs);
    }
    caseResults.push({
      documentId: testCase.groundTruth.id,
      status: result.status,
      error: result.error,
      latencyMs: result.providerMetadata?.latencyMs,
      counts,
    });
  }

  const overallCounts = mergeCounts(caseResults.map((r) => r.counts));
  const evaluation = evaluateAgainstTargets(toRates(overallCounts));
  const sortedLatencies = [...latencies].sort((a, b) => a - b);

  return {
    caseResults,
    overallCounts,
    evaluation,
    latency: { p50Ms: percentile(sortedLatencies, 50), p95Ms: percentile(sortedLatencies, 95) },
  };
}
