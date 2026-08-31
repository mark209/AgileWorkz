import {
  buildExtractionPrompt,
  mapUsageMetadata,
  parseExtractionResponse,
  VertexGeminiExtractionProvider,
} from "../src/common/extraction/providers/vertex-gemini.provider";
import { ExtractionContext } from "../src/common/extraction/extraction-provider.interface";

// No network access, no Vertex/Google credentials anywhere in this file —
// only the pure prompt-building and response-parsing logic, plus proving
// the provider class can be constructed via explicit DI (as
// ExtractionModule does) without touching process.env. Actually calling
// extractDocument() requires real Vertex AI credentials and is exercised
// only in the (not-yet-run) live acceptance test — see
// run-acceptance-test.spec.ts for the fully offline harness test.

const context: ExtractionContext = {
  reportTypeCode: "MAINTENANCE_CLEANING",
  allowedMeasurementTypes: [
    { code: "LOW_SIDE_PRESSURE", label: "Low Side Pressure" },
    { code: "HIGH_SIDE_PRESSURE", label: "High Side Pressure" },
  ],
  allowedMeasurementStages: [{ code: "BEFORE_CLEANING", label: "Before Cleaning" }],
  allowedProblemTypes: [{ code: "REFRIGERANT_LEAK", label: "Refrigerant Leak" }],
  allowedSignoffRoles: [{ code: "TECHNICIAN", label: "Technician" }],
};

describe("buildExtractionPrompt", () => {
  it("embeds every approved code from all four controlled vocabularies", () => {
    const prompt = buildExtractionPrompt(context);
    expect(prompt).toContain("LOW_SIDE_PRESSURE");
    expect(prompt).toContain("HIGH_SIDE_PRESSURE");
    expect(prompt).toContain("BEFORE_CLEANING");
    expect(prompt).toContain("REFRIGERANT_LEAK");
    expect(prompt).toContain("TECHNICIAN");
  });

  it("instructs the model never to convert units and never to invent a taxonomy code", () => {
    const prompt = buildExtractionPrompt(context);
    expect(prompt.toLowerCase()).toContain("never convert");
    expect(prompt.toLowerCase()).toContain("never invent");
  });

  it("explains all six category values", () => {
    const prompt = buildExtractionPrompt(context);
    for (const category of ["basicInfo", "equipmentUnit", "problem", "measurement", "narrativeItem", "signoff"]) {
      expect(prompt).toContain(category);
    }
  });

  // Stage A finding, corrected at the prompt level only (not the taxonomy):
  // an outdoor-unit "suction air temp" reading was being mis-suggested as
  // the indoor-specific code. The fix is section-based ("which table did
  // this appear under"), not a hardcoded field-name lookup — this test
  // only checks the rule is present and general, not tied to any one
  // report's wording.
  it("instructs the model to use document section context, not field wording, to distinguish indoor vs. outdoor readings", () => {
    const prompt = buildExtractionPrompt(context);
    expect(prompt.toLowerCase()).toContain("indoor vs. outdoor context from which section");
    expect(prompt.toLowerCase()).toContain("not from the field's literal wording alone");
  });

  // Phase 5 Stage C, Correction 2 (S/D taxonomy-policy violation): a bare
  // abbreviation like "S" or "D" on a pipe-size row must not be resolved to
  // a liquid/gas-specific code from general refrigeration convention alone
  // — only from what the document itself spells out. General wording check,
  // not tied to the specific S/D letters or any one report's layout.
  it("instructs the model not to infer taxonomy mappings from abbreviations the document itself doesn't spell out", () => {
    const prompt = buildExtractionPrompt(context);
    expect(prompt.toLowerCase()).toContain("bare letter");
    expect(prompt.toLowerCase()).toContain("does not have a");
    expect(prompt.toLowerCase()).toContain("abbreviation the document itself doesn't spell out");
  });

  // Phase 5 Stage C, Correction 4 (checkbox extraction reliability):
  // checkboxes must be treated as first-class extraction targets across the
  // whole page, not an afterthought behind the numeric measurement
  // sections. General instruction — no UPTWN-specific wording.
  it("instructs the model to extract every checkbox/checklist item on the page, not just numeric sections", () => {
    const prompt = buildExtractionPrompt(context);
    expect(prompt.toLowerCase()).toContain("every checkbox/checklist item");
    expect(prompt.toLowerCase()).toContain("checked");
    expect(prompt.toLowerCase()).toContain("unchecked");
  });

  // Phase 5 Stage C, Correction 1 (hallucination prevention on blank
  // fields): a single blank cell inside an otherwise-filled group must stay
  // null, not be filled in to match its neighbors.
  it("instructs the model not to fill in a blank field to match its filled-in group neighbors", () => {
    const prompt = buildExtractionPrompt(context);
    expect(prompt.toLowerCase()).toContain("single blank cell among filled ones");
  });

  it("handles an empty vocabulary without crashing", () => {
    const emptyContext: ExtractionContext = {
      reportTypeCode: "OTHER",
      allowedMeasurementTypes: [],
      allowedMeasurementStages: [],
      allowedProblemTypes: [],
      allowedSignoffRoles: [],
    };
    expect(() => buildExtractionPrompt(emptyContext)).not.toThrow();
  });
});

describe("parseExtractionResponse", () => {
  it("parses a well-formed response matching the schema", () => {
    const raw = JSON.stringify([
      {
        category: "measurement",
        fieldName: "Low Side Pressure",
        value: "65",
        unit: "psi",
        confidence: "high",
        suggestedMeasurementTypeCode: "LOW_SIDE_PRESSURE",
        stage: "before cleaning",
        groupKey: "unit-1",
      },
    ]);
    const fields = parseExtractionResponse(raw, context);
    expect(fields).toEqual([
      {
        category: "measurement",
        fieldName: "Low Side Pressure",
        value: "65",
        unit: "psi",
        confidence: "high",
        suggestedMeasurementTypeCode: "LOW_SIDE_PRESSURE",
        stage: "before cleaning",
        groupKey: "unit-1",
      },
    ]);
  });

  it("drops a field with an unrecognized category rather than guessing which staging table it belongs to", () => {
    const raw = JSON.stringify([
      { category: "notARealCategory", fieldName: "X", value: "1", unit: null, confidence: "high", suggestedMeasurementTypeCode: null },
      { category: "basicInfo", fieldName: "Customer Name", value: "Acme", unit: null, confidence: "high", suggestedMeasurementTypeCode: null },
    ]);
    const fields = parseExtractionResponse(raw, context);
    expect(fields).toHaveLength(1);
    expect(fields[0].fieldName).toBe("Customer Name");
  });

  it("drops a field with a missing category", () => {
    const raw = JSON.stringify([{ fieldName: "X", value: "1", unit: null, confidence: "high", suggestedMeasurementTypeCode: null }]);
    expect(parseExtractionResponse(raw, context)).toHaveLength(0);
  });

  it("nulls out a suggested code that is not in the approved list, rather than trusting it", () => {
    const raw = JSON.stringify([
      {
        category: "measurement",
        fieldName: "Mystery Reading",
        value: "12",
        unit: null,
        confidence: "medium",
        suggestedMeasurementTypeCode: "SOME_CODE_THE_MODEL_INVENTED",
      },
    ]);
    const fields = parseExtractionResponse(raw, context);
    expect(fields[0].suggestedMeasurementTypeCode).toBeNull();
  });

  it("preserves a null suggested code as unresolved (not coerced to anything else)", () => {
    const raw = JSON.stringify([
      { category: "measurement", fieldName: "Illegible Field", value: null, unit: null, confidence: "unreadable", suggestedMeasurementTypeCode: null },
    ]);
    const fields = parseExtractionResponse(raw, context);
    expect(fields[0].suggestedMeasurementTypeCode).toBeNull();
    expect(fields[0].value).toBeNull();
  });

  it("falls back to \"unreadable\" confidence for an invalid confidence value rather than throwing", () => {
    const raw = JSON.stringify([
      { category: "measurement", fieldName: "F", value: "1", unit: null, confidence: "very-sure", suggestedMeasurementTypeCode: null },
    ]);
    const fields = parseExtractionResponse(raw, context);
    expect(fields[0].confidence).toBe("unreadable");
  });

  it("throws on invalid JSON rather than silently returning an empty array", () => {
    expect(() => parseExtractionResponse("not json", context)).toThrow(/valid JSON/);
  });

  it("throws when the top-level response is not an array", () => {
    expect(() => parseExtractionResponse(JSON.stringify({ fieldName: "x" }), context)).toThrow(/JSON array/);
  });

  it("never converts a unit — passes the raw unit string through unchanged", () => {
    const raw = JSON.stringify([
      {
        category: "measurement",
        fieldName: "High Side Pressure",
        value: "280",
        unit: "kg/cm2",
        confidence: "high",
        suggestedMeasurementTypeCode: "HIGH_SIDE_PRESSURE",
      },
    ]);
    const fields = parseExtractionResponse(raw, context);
    expect(fields[0].unit).toBe("kg/cm2");
  });

  it("omits stage entirely (not null) when the field is not a measurement", () => {
    const raw = JSON.stringify([
      { category: "basicInfo", fieldName: "Customer Name", value: "Acme", unit: null, confidence: "high", suggestedMeasurementTypeCode: null },
    ]);
    const fields = parseExtractionResponse(raw, context);
    expect(fields[0].stage).toBeUndefined();
  });
});

describe("VertexGeminiExtractionProvider construction", () => {
  it("can be constructed via explicit config injection without reading process.env", () => {
    const provider = new VertexGeminiExtractionProvider({
      projectId: "test-project",
      region: "asia-southeast1",
      modelId: "gemini-2.5-flash",
    });
    expect(provider).toBeInstanceOf(VertexGeminiExtractionProvider);
  });
});

// Stage B requirement (Phase 5 Approved Baseline §04a-13) — real cost
// measurement needs Vertex's own reported token usage, not an estimate.
// Field names are carried through as-is from the SDK's own usage metadata
// shape, not renamed or recomputed here.
describe("mapUsageMetadata", () => {
  it("returns undefined when the SDK reports no usage metadata at all", () => {
    expect(mapUsageMetadata(undefined)).toBeUndefined();
  });

  it("carries through every token category the SDK can report, including thoughtsTokenCount", () => {
    const usage = mapUsageMetadata({
      promptTokenCount: 640,
      candidatesTokenCount: 1350,
      thoughtsTokenCount: 220,
      totalTokenCount: 2210,
    });
    expect(usage).toEqual({
      promptTokenCount: 640,
      candidatesTokenCount: 1350,
      thoughtsTokenCount: 220,
      cachedContentTokenCount: undefined,
      toolUsePromptTokenCount: undefined,
      totalTokenCount: 2210,
    });
  });

  it("passes through cachedContentTokenCount and toolUsePromptTokenCount when the SDK reports them", () => {
    const usage = mapUsageMetadata({
      promptTokenCount: 100,
      candidatesTokenCount: 50,
      cachedContentTokenCount: 30,
      toolUsePromptTokenCount: 12,
      totalTokenCount: 192,
    });
    expect(usage?.cachedContentTokenCount).toBe(30);
    expect(usage?.toolUsePromptTokenCount).toBe(12);
  });

  it("does not invent a totalTokenCount when the SDK doesn't report one", () => {
    const usage = mapUsageMetadata({ promptTokenCount: 100, candidatesTokenCount: 50 });
    expect(usage?.totalTokenCount).toBeUndefined();
  });
});
