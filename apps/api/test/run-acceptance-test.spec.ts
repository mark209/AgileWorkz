import {
  ExtractedField,
  ExtractionBatchResult,
  ExtractionContext,
  ExtractionDocumentInput,
  ExtractionProvider,
} from "../src/common/extraction/extraction-provider.interface";
import { AcceptanceTestCase, runAcceptanceTest } from "../src/common/extraction/acceptance-test/run-acceptance-test";

// A deterministic in-memory fake — proves the harness's wiring and
// aggregation are correct without any real Gemini/Vertex call or
// credentials. Point run-acceptance-test at VertexGeminiExtractionProvider
// with real sample-form fixtures once credentials exist (Phase 5 Approved
// Baseline §04a-13) — that run is not part of this increment.
class FakeExtractionProvider implements ExtractionProvider {
  constructor(
    private readonly responses: Map<string, ExtractionBatchResult>,
    private readonly latencyMs = 42,
  ) {}

  async extractDocument(document: ExtractionDocumentInput, _context: ExtractionContext): Promise<ExtractionBatchResult> {
    const key = document.content.toString("utf8");
    const response = this.responses.get(key);
    if (!response) {
      throw new Error(`FakeExtractionProvider has no canned response for key "${key}"`);
    }
    return { ...response, providerMetadata: { model: "fake-model", latencyMs: this.latencyMs } };
  }
}

function makeCase(id: string): AcceptanceTestCase {
  const context: ExtractionContext = {
    reportTypeCode: "MAINTENANCE_CLEANING",
    allowedMeasurementTypes: [{ code: "LOW_SIDE_PRESSURE", label: "Low Side Pressure" }],
    allowedMeasurementStages: [],
    allowedProblemTypes: [],
    allowedSignoffRoles: [],
  };
  return {
    document: { content: Buffer.from(id, "utf8"), mimeType: "image/jpeg" },
    context,
    groundTruth: {
      id,
      reportTypeCode: "MAINTENANCE_CLEANING",
      fields: [
        {
          fieldName: "Low Side Pressure",
          sourceType: "handwritten",
          fieldKind: "numeric",
          expectedValue: "65",
          expectedUnit: "psi",
          expectedMeasurementTypeCode: "LOW_SIDE_PRESSURE",
        },
      ],
    },
  };
}

describe("runAcceptanceTest", () => {
  it("runs every case through the provider and aggregates counts/evaluation across all of them", async () => {
    const correctFields: ExtractedField[] = [
      { category: "measurement", fieldName: "Low Side Pressure", value: "65", unit: "psi", confidence: "high", suggestedMeasurementTypeCode: "LOW_SIDE_PRESSURE" },
    ];
    const wrongFields: ExtractedField[] = [
      { category: "measurement", fieldName: "Low Side Pressure", value: "70", unit: "psi", confidence: "high", suggestedMeasurementTypeCode: "LOW_SIDE_PRESSURE" },
    ];

    const cases = [makeCase("doc-a"), makeCase("doc-b")];
    const provider = new FakeExtractionProvider(
      new Map([
        ["doc-a", { status: "extracted", fields: correctFields }],
        ["doc-b", { status: "extracted", fields: wrongFields }],
      ]),
    );

    const report = await runAcceptanceTest(provider, cases);

    expect(report.caseResults).toHaveLength(2);
    expect(report.caseResults[0].status).toBe("extracted");
    expect(report.overallCounts.valueUnitTotal).toBe(2);
    expect(report.overallCounts.valueUnitCorrect).toBe(1); // doc-a right, doc-b wrong value

    const valueUnitRow = report.evaluation.find((r) => r.criterion === "valueUnitPreservationRate")!;
    expect(valueUnitRow.actual).toBe(0.5);
    expect(valueUnitRow.meetsTarget).toBe(false); // 0.5 < the approved 0.98 target
  });

  it("records latency per case and computes p50/p95 across the run", async () => {
    const fields: ExtractedField[] = [
      { category: "measurement", fieldName: "Low Side Pressure", value: "65", unit: "psi", confidence: "high", suggestedMeasurementTypeCode: "LOW_SIDE_PRESSURE" },
    ];
    const cases = [makeCase("doc-a"), makeCase("doc-b")];
    const provider = new FakeExtractionProvider(
      new Map([
        ["doc-a", { status: "extracted", fields }],
        ["doc-b", { status: "extracted", fields }],
      ]),
      100,
    );

    const report = await runAcceptanceTest(provider, cases);
    expect(report.caseResults.every((r) => r.latencyMs === 100)).toBe(true);
    expect(report.latency.p50Ms).toBe(100);
    expect(report.latency.p95Ms).toBe(100);
  });

  it("propagates a failed case's status without throwing, so one bad document doesn't abort the whole run", async () => {
    const cases = [makeCase("doc-a")];
    const provider = new FakeExtractionProvider(new Map([["doc-a", { status: "failed", fields: [], error: "unreadable document" }]]));

    const report = await runAcceptanceTest(provider, cases);
    expect(report.caseResults[0].status).toBe("failed");
    expect(report.caseResults[0].error).toBe("unreadable document");
  });
});
