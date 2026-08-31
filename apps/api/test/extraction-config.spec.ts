import { loadVertexGeminiConfig } from "../src/common/extraction/extraction-config";

function omit(env: NodeJS.ProcessEnv, key: string): NodeJS.ProcessEnv {
  const copy = { ...env };
  delete copy[key];
  return copy;
}

describe("loadVertexGeminiConfig", () => {
  const validEnv = {
    VERTEX_AI_PROJECT_ID: "agileworks-prod",
    VERTEX_AI_REGION: "asia-southeast1",
    VERTEX_AI_MODEL_ID: "gemini-2.5-flash",
  } as NodeJS.ProcessEnv;

  it("returns the config when all three variables are present and the region is locational", () => {
    expect(loadVertexGeminiConfig(validEnv)).toEqual({
      projectId: "agileworks-prod",
      region: "asia-southeast1",
      modelId: "gemini-2.5-flash",
    });
  });

  it("throws when VERTEX_AI_PROJECT_ID is missing", () => {
    expect(() => loadVertexGeminiConfig(omit(validEnv, "VERTEX_AI_PROJECT_ID"))).toThrow(/VERTEX_AI_PROJECT_ID/);
  });

  it("throws when VERTEX_AI_MODEL_ID is missing — the model must never be silently defaulted", () => {
    expect(() => loadVertexGeminiConfig(omit(validEnv, "VERTEX_AI_MODEL_ID"))).toThrow(/VERTEX_AI_MODEL_ID/);
  });

  it("throws rather than falling back when VERTEX_AI_REGION is \"global\"", () => {
    expect(() => loadVertexGeminiConfig({ ...validEnv, VERTEX_AI_REGION: "global" })).toThrow(/global.*endpoint/i);
  });

  it("throws rather than falling back when VERTEX_AI_REGION is case-variant \"Global\"", () => {
    expect(() => loadVertexGeminiConfig({ ...validEnv, VERTEX_AI_REGION: "Global" })).toThrow(/global.*endpoint/i);
  });

  it("throws when VERTEX_AI_REGION is an empty string rather than treating it as unset silently", () => {
    expect(() => loadVertexGeminiConfig({ ...validEnv, VERTEX_AI_REGION: "" })).toThrow();
  });

  it("accepts a locational region other than asia-southeast1 without special-casing it", () => {
    expect(loadVertexGeminiConfig({ ...validEnv, VERTEX_AI_REGION: "us-central1" }).region).toBe("us-central1");
  });
});
