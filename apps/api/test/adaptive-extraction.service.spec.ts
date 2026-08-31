import { AdaptiveExtractionService } from "../src/common/extraction/adaptive-extraction.service";
import {
  ExtractedField,
  ExtractionBatchResult,
  ExtractionContext,
  ExtractionDocumentInput,
  ExtractionProvider,
} from "../src/common/extraction/extraction-provider.interface";

// Phase 5 Stage C, steps 1-3 (adaptive orchestration) — the provider itself
// is a hand-written fake queue, so these tests exercise real escalation
// decisions and real reconciliation, with zero network calls.

class QueuedFakeProvider implements ExtractionProvider {
  public callCount = 0;
  constructor(private readonly responses: ExtractionBatchResult[]) {}
  async extractDocument(_document: ExtractionDocumentInput, _context: ExtractionContext): Promise<ExtractionBatchResult> {
    const response = this.responses[Math.min(this.callCount, this.responses.length - 1)];
    this.callCount += 1;
    return response;
  }
}

const document: ExtractionDocumentInput = { content: Buffer.from("fake"), mimeType: "application/pdf" };

const startUpContext: ExtractionContext = {
  reportTypeCode: "INSTALLATION_COMMISSIONING",
  allowedMeasurementTypes: [],
  allowedMeasurementStages: [],
  allowedProblemTypes: [],
  allowedSignoffRoles: [],
};

function cleanField(overrides: Partial<ExtractedField> = {}): ExtractedField {
  return {
    category: "basicInfo",
    fieldName: "Customer Name",
    value: "Acme HVAC",
    unit: null,
    confidence: "high",
    suggestedMeasurementTypeCode: null,
    ...overrides,
  };
}

describe("AdaptiveExtractionService", () => {
  it("uses exactly 1 call when the single extraction passes deterministic validation", async () => {
    const provider = new QueuedFakeProvider([
      { status: "extracted", fields: [cleanField()], providerMetadata: { model: "fake", latencyMs: 100 } },
    ]);
    const service = new AdaptiveExtractionService(provider);
    const result = await service.extract(document, startUpContext);

    expect(result.callsUsed).toBe(1);
    expect(provider.callCount).toBe(1);
    expect(result.status).toBe("extracted");
    expect(result.verificationTriggers).toEqual([]);
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].reconciliationStatus).toBe("single-call");
  });

  it("escalates to 3 calls and reconciles when validation flags a concern", async () => {
    const suspiciousField = cleanField({
      category: "measurement",
      fieldName: "Breaker Capacity",
      value: "ISA",
      confidence: "high",
      suggestedMeasurementTypeCode: "BREAKER_CAPACITY",
    });
    const cleanReading = cleanField({
      category: "measurement",
      fieldName: "Breaker Capacity",
      value: "30",
      confidence: "high",
      suggestedMeasurementTypeCode: "BREAKER_CAPACITY",
    });
    const provider = new QueuedFakeProvider([
      { status: "extracted", fields: [suspiciousField], providerMetadata: { model: "fake" } },
      { status: "extracted", fields: [cleanReading], providerMetadata: { model: "fake" } },
      { status: "extracted", fields: [cleanReading], providerMetadata: { model: "fake" } },
    ]);
    const service = new AdaptiveExtractionService(provider);
    const result = await service.extract(document, startUpContext);

    expect(provider.callCount).toBe(3);
    expect(result.callsUsed).toBe(3);
    expect(result.verificationTriggers.map((t) => t.reason)).toContain("suspicious-value-format");
    expect(result.fields).toHaveLength(1);
    // 2 of 3 (the two clean "30" readings) win the majority vote.
    expect(result.fields[0].value).toBe("30");
    expect(result.fields[0].reconciliationStatus).toBe("majority");
  });

  it("does not escalate on a failed first call — a provider failure is returned as-is with callsUsed 1", async () => {
    const provider = new QueuedFakeProvider([{ status: "failed", fields: [], error: "document unreadable" }]);
    const service = new AdaptiveExtractionService(provider);
    const result = await service.extract(document, startUpContext);

    expect(provider.callCount).toBe(1);
    expect(result.callsUsed).toBe(1);
    expect(result.status).toBe("failed");
    expect(result.error).toBe("document unreadable");
    expect(result.fields).toEqual([]);
  });

  it("escalates on a partial extraction status even when no field individually triggers validation", async () => {
    const provider = new QueuedFakeProvider([
      { status: "partial", fields: [cleanField()], providerMetadata: { model: "fake" } },
      { status: "extracted", fields: [cleanField()], providerMetadata: { model: "fake" } },
      { status: "extracted", fields: [cleanField()], providerMetadata: { model: "fake" } },
    ]);
    const service = new AdaptiveExtractionService(provider);
    const result = await service.extract(document, startUpContext);

    expect(provider.callCount).toBe(3);
    expect(result.callsUsed).toBe(3);
    expect(result.verificationTriggers.map((t) => t.reason)).toContain("partial-extraction-status");
  });

  it("never invents a value merely to reach consensus — a genuine 3-way split resolves to unresolved/null and flags human verification", async () => {
    // Call 1's own field must trip a validation trigger for escalation to
    // happen at all (the service decides whether to escalate from call 1
    // alone) — low confidence guarantees that regardless of the value.
    const v1 = cleanField({ category: "measurement", fieldName: "Voltage", value: "220", confidence: "low", suggestedMeasurementTypeCode: "VOLTAGE" });
    const v2 = { ...v1, value: "230" };
    const v3 = { ...v1, value: "9999" }; // distinct from both, guarantees no majority pair
    const provider = new QueuedFakeProvider([
      { status: "extracted", fields: [v1], providerMetadata: { model: "fake" } },
      { status: "extracted", fields: [v2], providerMetadata: { model: "fake" } },
      { status: "extracted", fields: [v3], providerMetadata: { model: "fake" } },
    ]);
    const service = new AdaptiveExtractionService(provider);
    const result = await service.extract(document, startUpContext);

    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].value).toBeNull();
    expect(result.fields[0].confidence).toBe("unreadable");
    expect(result.fields[0].reconciliationStatus).toBe("unresolved");
    expect(result.fields[0].requiresHumanVerification).toBe(true);
  });

  it("sums token usage across every call actually made", async () => {
    const provider = new QueuedFakeProvider([
      {
        status: "extracted",
        fields: [cleanField({ category: "measurement", fieldName: "S", value: "3/8", confidence: "high", suggestedMeasurementTypeCode: "PIPE_SIZE_LIQUID" })],
        providerMetadata: { model: "fake", usage: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 } },
      },
      {
        status: "extracted",
        fields: [cleanField()],
        providerMetadata: { model: "fake", usage: { promptTokenCount: 90, candidatesTokenCount: 40, totalTokenCount: 130 } },
      },
      {
        status: "extracted",
        fields: [cleanField()],
        providerMetadata: { model: "fake", usage: { promptTokenCount: 95, candidatesTokenCount: 45, totalTokenCount: 140 } },
      },
    ]);
    const service = new AdaptiveExtractionService(provider);
    const result = await service.extract(document, startUpContext);

    expect(result.callsUsed).toBe(3);
    expect(result.totalUsage.promptTokenCount).toBe(285);
    expect(result.totalUsage.candidatesTokenCount).toBe(135);
    expect(result.totalUsage.totalTokenCount).toBe(420);
    expect(result.perCallMetadata).toHaveLength(3);
  });
});
