import { Injectable, Logger } from "@nestjs/common";
import { GenerateContentResponseUsageMetadata, GoogleGenAI, Schema, Type } from "@google/genai";
import {
  ExtractedField,
  ExtractionBatchResult,
  ExtractionConfidence,
  ExtractionContext,
  ExtractionDocumentInput,
  ExtractionFieldCategory,
  ExtractionProvider,
  ExtractionTaxonomyOption,
  ExtractionTokenUsage,
} from "../extraction-provider.interface";
import { loadVertexGeminiConfig, VertexGeminiConfig } from "../extraction-config";

const VALID_CONFIDENCE_VALUES: ReadonlySet<string> = new Set<ExtractionConfidence>([
  "high",
  "medium",
  "low",
  "unreadable",
]);

const VALID_CATEGORY_VALUES: ReadonlySet<string> = new Set<ExtractionFieldCategory>([
  "basicInfo",
  "equipmentUnit",
  "problem",
  "measurement",
  "narrativeItem",
  "signoff",
]);

/**
 * responseSchema passed to Vertex AI's generateContent (structured output —
 * see Phase 5 Approved Baseline §04a-4). Mirrors ExtractedField exactly so
 * the parsed JSON needs no shape transformation before validation.
 *
 * `category` is constrained via a Gemini `enum` — safe to do because it's a
 * fixed, structural set of six values (which extraction_* staging table a
 * field routes to) that never changes. `suggestedMeasurementTypeCode` is
 * deliberately left as a free string, NOT an enum constraint — the approved
 * 33-code list can grow over time (new measurement types seeded), and
 * re-validating the model's output against the *current* allowed set
 * happens in parseExtractionResponse below, not by baking the list into the
 * schema itself.
 */
const EXTRACTION_RESPONSE_SCHEMA: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      category: { type: Type.STRING, enum: ["basicInfo", "equipmentUnit", "problem", "measurement", "narrativeItem", "signoff"] },
      fieldName: { type: Type.STRING },
      value: { type: Type.STRING, nullable: true },
      unit: { type: Type.STRING, nullable: true },
      confidence: { type: Type.STRING, enum: ["high", "medium", "low", "unreadable"] },
      suggestedMeasurementTypeCode: { type: Type.STRING, nullable: true },
      stage: { type: Type.STRING, nullable: true },
      groupKey: { type: Type.STRING, nullable: true },
    },
    required: ["category", "fieldName", "value", "unit", "confidence", "suggestedMeasurementTypeCode"],
  },
};

function formatOptionList(options: ExtractionTaxonomyOption[]): string {
  if (options.length === 0) {
    return "(none configured)";
  }
  return options.map((option) => `- ${option.code}: ${option.label}`).join("\n");
}

/**
 * Pure function — builds the extraction prompt from the controlled
 * vocabularies in ExtractionContext. No network access, no Vertex client
 * needed, fully unit-testable without any credentials.
 */
export function buildExtractionPrompt(context: ExtractionContext): string {
  return [
    `You are extracting data from a scanned HVAC service report. Report type: ${context.reportTypeCode}.`,
    "",
    "Return ONLY a JSON array matching the required response schema. Do not include any prose, explanation, or markdown formatting.",
    "",
    "Rules — follow these exactly:",
    '1. "category" must be exactly one of: basicInfo (report header fields like customer/date/technician), equipmentUnit ' +
      "(fields identifying one piece of equipment), problem (a reported issue/finding), measurement (a numeric or checkbox " +
      "reading, with a unit if one is written), narrativeItem (free-text notes/recommendations), signoff (a name/role/date on " +
      "a signature line).",
    "2. Transcribe every value and unit EXACTLY as printed or handwritten on the document. Never convert or normalize a unit " +
      "(for example: do not convert psi to kg/cm^2, do not convert degF to degC, do not convert inches to mm). Keep the unit " +
      "text exactly as it appears, or null if no unit is written. unit only applies to category \"measurement\" — leave it " +
      "null for every other category.",
    "3. Never report a value that is not visibly present on the document. Before writing any value, confirm you can point to " +
      "actual printed or handwritten marks forming exactly that value — if you are inferring, estimating, or completing a " +
      'pattern rather than reading real marks, set value to null and confidence to "unreadable" rather than guessing. This ' +
      "applies even when a field is part of a group where most other fields in the same group DO have a clear value — a " +
      "single blank cell among filled ones is common on real forms and must stay null, not be filled in to match its " +
      "neighbors.",
    '4. "suggestedMeasurementTypeCode" only applies to category "measurement". It must be exactly one of the codes listed ' +
      "below, or null. Only set it when you are confident the field matches that specific measurement type. Never invent a " +
      "code that is not in the list below, and never pick the closest match if you are unsure — use null instead. Leave it " +
      "null for every other category.",
    "5. Do not use general domain convention or common industry abbreviation meanings to resolve a taxonomy mapping that the " +
      "field's own wording on THIS document does not make explicit. For example, a pipe-size row labeled only with a bare " +
      "letter such as \"S\" or \"D\" (without the words \"Liquid\" or \"Gas\" actually printed or written) does not have a " +
      "confirmed meaning — do not map it to a liquid- or gas-specific code based on what those letters usually mean in " +
      "refrigeration work. Leave suggestedMeasurementTypeCode null for any field whose category mapping depends on an " +
      "abbreviation the document itself doesn't spell out.",
    "6. Determine indoor vs. outdoor context from which section/table of the document a field appears in (for example an " +
      '"Outdoor Unit" section vs. an "Indoor Unit"/FCU table), not from the field\'s literal wording alone. Air-temperature ' +
      "readings under an outdoor-unit section (commonly labeled things like \"suction air temp\" or \"discharge air temp\" " +
      "near outdoor/condensing equipment) must use the outdoor-specific measurement type codes, never the indoor-specific " +
      "ones — even though \"suction\" and \"return\" (or \"discharge\" and \"supply\") describe similar physical airflow " +
      "roles, those code pairs are kept separate because indoor and outdoor equipment use different terminology on real " +
      "HVAC service forms. Air-temperature readings under an indoor-unit/FCU section use the indoor-specific codes instead. " +
      "This rule is about which section of the document the reading belongs to, not the specific wording of any one form.",
    '7. "stage" only applies to category "measurement" — the raw stage label as written or implied (for example "before ' +
      'cleaning", "after repair"), or null if the document does not distinguish a stage for that reading. Do not map it to a ' +
      "code yourself — write it exactly as observed.",
    "8. Use groupKey to associate fields that belong to the same repeating row (for example, all readings for one specific " +
      "piece of equipment), so that repeating rows and indoor/outdoor units are not conflated with each other.",
    "9. This document may contain many checkbox or checklist items (a box, square, or circle that is marked or left empty), " +
      "sometimes dozens across several sections. Checkboxes are just as important as numeric readings — attempt to extract " +
      'EVERY checkbox/checklist item visible on the page, not just the numeric data sections. Report each one with value ' +
      '"checked" or "unchecked" exactly matching its marked state, using its printed label as fieldName.',
    "",
    "Approved measurement type codes (for suggestedMeasurementTypeCode only):",
    formatOptionList(context.allowedMeasurementTypes),
    "",
    "Approved measurement stage codes (for context only, e.g. before/after cleaning or repair):",
    formatOptionList(context.allowedMeasurementStages),
    "",
    "Approved problem type codes (for context only):",
    formatOptionList(context.allowedProblemTypes),
    "",
    "Approved sign-off role codes (for context only):",
    formatOptionList(context.allowedSignoffRoles),
  ].join("\n");
}

/**
 * Pure function — parses and validates the model's raw JSON text against
 * ExtractionContext's currently-approved codes. Any suggested code the model
 * returns that is NOT in the current allowed set is treated as unresolved
 * (null), never rejected outright and never coerced to a "closest" guess —
 * this is what makes "never invent a taxonomy code" a code-enforced
 * guarantee rather than only a prompt instruction the model might ignore.
 * A field with an invalid/missing category is dropped rather than guessed
 * at, since there is no safe default staging table to route it to.
 * No network access, fully unit-testable without any credentials.
 */
export function parseExtractionResponse(rawText: string, context: ExtractionContext): ExtractedField[] {
  const allowedMeasurementTypeCodes = new Set(context.allowedMeasurementTypes.map((option) => option.code));

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("Vertex AI response was not valid JSON despite the configured responseSchema.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Vertex AI response was not a JSON array, as required by the configured responseSchema.");
  }

  const fields: ExtractedField[] = [];
  parsed.forEach((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`Extraction response item at index ${index} is not an object.`);
    }
    const record = item as Record<string, unknown>;

    if (!VALID_CATEGORY_VALUES.has(record.category as string)) {
      // No safe default table to route an unrecognized category to — drop
      // the field rather than guess. A single malformed entry should not
      // invalidate the rest of a batch.
      return;
    }
    const category = record.category as ExtractionFieldCategory;

    const fieldName = typeof record.fieldName === "string" ? record.fieldName : "";
    const value = typeof record.value === "string" ? record.value : null;
    const unit = typeof record.unit === "string" ? record.unit : null;
    const confidence: ExtractionConfidence = VALID_CONFIDENCE_VALUES.has(record.confidence as string)
      ? (record.confidence as ExtractionConfidence)
      : "unreadable";

    const rawSuggestedCode = typeof record.suggestedMeasurementTypeCode === "string" ? record.suggestedMeasurementTypeCode : null;
    const suggestedMeasurementTypeCode =
      rawSuggestedCode !== null && allowedMeasurementTypeCodes.has(rawSuggestedCode) ? rawSuggestedCode : null;

    const field: ExtractedField = {
      category,
      fieldName,
      value,
      unit,
      confidence,
      suggestedMeasurementTypeCode,
    };
    if (typeof record.stage === "string") {
      field.stage = record.stage;
    }
    if (typeof record.groupKey === "string") {
      field.groupKey = record.groupKey;
    }
    fields.push(field);
  });

  return fields;
}

/**
 * Pure function — maps the SDK's usage metadata shape onto our own
 * ExtractionTokenUsage (Phase 5 Approved Baseline §04a-13, Stage B cost
 * measurement). Field names are carried through as-is, not renamed or
 * recomputed, so a cost estimate downstream is working from Vertex's own
 * reported numbers. Returns undefined when the SDK reports no usage at all
 * (e.g. the "no text content" failure path may still have it — this only
 * guards against a genuinely absent object).
 */
export function mapUsageMetadata(usage: GenerateContentResponseUsageMetadata | undefined): ExtractionTokenUsage | undefined {
  if (!usage) return undefined;
  return {
    promptTokenCount: usage.promptTokenCount,
    candidatesTokenCount: usage.candidatesTokenCount,
    thoughtsTokenCount: usage.thoughtsTokenCount,
    cachedContentTokenCount: usage.cachedContentTokenCount,
    toolUsePromptTokenCount: usage.toolUsePromptTokenCount,
    totalTokenCount: usage.totalTokenCount,
  };
}

/**
 * Adapter implementing ExtractionProvider against Vertex AI Gemini. Never
 * touches Prisma, the database, storage, or the queue — a pure function of
 * (document, context) -> result, which is what keeps it swappable behind
 * the interface and testable in isolation (Phase 5 Approved Baseline §04a-3
 * and §04a-13's acceptance-test harness).
 *
 * The model ID is read from config, never hard-coded (§04a Decision 1) — no
 * default is applied here; loadVertexGeminiConfig() throws at construction
 * time if it is missing, and refuses a "global" VERTEX_AI_REGION outright
 * rather than silently falling back to one.
 *
 * Error handling is split deliberately (§04a-7): a failure calling Vertex AI
 * itself (network, timeout, 5xx, rate-limit) is allowed to PROPAGATE as a
 * thrown exception, so the queue processor's BullMQ retry/backoff can handle
 * it as transient. A response that comes back successfully but fails to
 * parse/validate is the model's fault, not a transient network issue — that
 * is caught here and returned as a structured `status: "failed"` result, so
 * the processor marks EXTRACTION_FAILED without a pointless retry loop.
 */
@Injectable()
export class VertexGeminiExtractionProvider implements ExtractionProvider {
  private readonly logger = new Logger(VertexGeminiExtractionProvider.name);
  private readonly config: VertexGeminiConfig;
  private client: GoogleGenAI | undefined;

  constructor(config: VertexGeminiConfig = loadVertexGeminiConfig()) {
    this.config = config;
  }

  private getClient(): GoogleGenAI {
    if (!this.client) {
      this.client = new GoogleGenAI({
        vertexai: true,
        project: this.config.projectId,
        location: this.config.region,
      });
    }
    return this.client;
  }

  async extractDocument(document: ExtractionDocumentInput, context: ExtractionContext): Promise<ExtractionBatchResult> {
    const startedAt = Date.now();
    const prompt = buildExtractionPrompt(context);

    // Not caught here — a network/API-level failure propagates so the queue
    // processor can retry it as transient (§04a-6/7).
    const response = await this.getClient().models.generateContent({
      model: this.config.modelId,
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }, { inlineData: { mimeType: document.mimeType, data: document.content.toString("base64") } }],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: EXTRACTION_RESPONSE_SCHEMA,
      },
    });

    const usage = mapUsageMetadata(response.usageMetadata);
    const rawText = response.text;
    if (!rawText) {
      return {
        status: "failed",
        fields: [],
        error: "Vertex AI returned no text content.",
        providerMetadata: { model: this.config.modelId, latencyMs: Date.now() - startedAt, usage },
      };
    }

    try {
      const fields = parseExtractionResponse(rawText, context);
      return {
        status: fields.length > 0 ? "extracted" : "partial",
        fields,
        providerMetadata: { model: this.config.modelId, latencyMs: Date.now() - startedAt, usage },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Vertex AI response validation failed: ${message}`);
      return {
        status: "failed",
        fields: [],
        error: message,
        providerMetadata: { model: this.config.modelId, latencyMs: Date.now() - startedAt, usage },
      };
    }
  }
}
