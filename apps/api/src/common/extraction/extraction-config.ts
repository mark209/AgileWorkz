/**
 * Config loader for the Vertex AI Gemini provider. Deliberately separate
 * from env.validation.ts's boot-time presence checks: this module owns the
 * one rule that matters most for the approved design (Phase 5 Approved
 * Baseline §04a Decision 1) — the model ID is never hard-coded, and a
 * "global" (non-regional) endpoint is refused outright rather than silently
 * used as a fallback, because only a locational endpoint keeps ML
 * processing inside the configured region/jurisdiction.
 */

export interface VertexGeminiConfig {
  projectId: string;
  region: string;
  modelId: string;
}

// Values that resolve to Vertex AI's global (non-locational) endpoint. Any
// of these in VERTEX_AI_REGION means the data-residency guarantee the
// approved design relies on does not hold — refuse to start rather than
// silently fall back.
const NON_LOCATIONAL_REGION_VALUES = new Set(["global", ""]);

export function loadVertexGeminiConfig(env: NodeJS.ProcessEnv = process.env): VertexGeminiConfig {
  const projectId = env.VERTEX_AI_PROJECT_ID?.trim();
  const region = env.VERTEX_AI_REGION?.trim();
  const modelId = env.VERTEX_AI_MODEL_ID?.trim();

  if (!projectId) {
    throw new Error("VERTEX_AI_PROJECT_ID is required when EXTRACTION_PROVIDER=vertex-gemini.");
  }
  if (!region) {
    throw new Error("VERTEX_AI_REGION is required when EXTRACTION_PROVIDER=vertex-gemini.");
  }
  if (NON_LOCATIONAL_REGION_VALUES.has(region.toLowerCase())) {
    throw new Error(
      `VERTEX_AI_REGION="${region}" resolves to a global (non-locational) endpoint. The approved design ` +
        `(Phase 5 Approved Baseline §04a) requires a locational endpoint such as "asia-southeast1" so ML ` +
        "processing stays inside the configured region — refusing to silently fall back to a global endpoint " +
        "or another region. Set VERTEX_AI_REGION explicitly, or stop and report if no suitable region/model exists.",
    );
  }
  if (!modelId) {
    throw new Error(
      "VERTEX_AI_MODEL_ID is required when EXTRACTION_PROVIDER=vertex-gemini. The model must be configured " +
        "explicitly — this is deliberately never defaulted or hard-coded, per the approved design's Decision 1 " +
        "(exact model availability in the target region must be verified live before it is set).",
    );
  }

  return { projectId, region, modelId };
}
